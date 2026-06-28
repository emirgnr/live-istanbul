/**
 * Schedule/headway-based train-position simulation.
 *
 * No live GPS feed exists for Istanbul rail (see docs/research), so we compute where
 * each train *should* be at wall-clock time T: trains are spawned from each terminus at
 * the period-appropriate headway, then positioned along the line geometry using
 * per-segment run-times + dwell. Output is a deterministic function of T — running it
 * every animation frame yields smooth motion with no per-tick interpolation needed.
 */
import type {
  Direction,
  LineId,
  LngLat,
  NetworkSnapshot,
  RailNetwork,
  ServiceDayType,
  StationId,
  TrainPhase,
  TrainSnapshot,
} from '@/lib/network/types'
import { cumulativeDistances, pointAtDistance } from '@/lib/geo'
import { network as defaultNetwork } from '@/data'

interface Leg {
  geometry: LngLat[]
  cum: number[]
  lengthM: number
  runTimeS: number
  fromId: StationId
  toId: StationId
}

interface TripPlan {
  lineId: LineId
  direction: Direction
  legs: Leg[]
  /** arrival time (s) at each station, index 0..n; arrive[0] = 0 */
  arrive: number[]
  /** departure time (s) from each station; depart[last] = arrive[last] */
  depart: number[]
  cycleSec: number
  stationCoord: LngLat[]
  /** Station ids in travel order for this direction (length = arrive.length). */
  stationIds: StationId[]
  /** Kinematic params for intra-segment positioning (undefined → linear interpolation). */
  cruiseMps?: number
  aAcc?: number
  aDec?: number
}

const SECONDS_PER_DAY = 86_400

// ---------------------------------------------------------------------------
// time helpers
// ---------------------------------------------------------------------------
export function dayType(date: Date): ServiceDayType {
  const d = date.getDay() // 0 Sun … 6 Sat
  if (d === 0) return 'sunday'
  if (d === 6) return 'saturday'
  return 'weekday'
}

export function secondsSinceMidnight(date: Date): number {
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() + date.getMilliseconds() / 1000
}

// ---------------------------------------------------------------------------
// trip plans (memoized per line+direction)
// ---------------------------------------------------------------------------
const planCache = new Map<string, TripPlan>()

function buildPlan(net: RailNetwork, lineId: LineId, direction: Direction, dwellMult = 1): TripPlan {
  const mq = Math.round(dwellMult * 20) / 20 // quantize to 0.05 so a few plans cover the day
  const cacheKey = `${lineId}:${direction}:${mq}`
  const cached = planCache.get(cacheKey)
  if (cached) return cached

  const schedule = net.schedules[lineId]
  const segs = net.segments[lineId] ?? []
  const cal = schedule?.calibration
  const nSt = segs.length + 1

  // per-station dwell aligned to travel order, scaled by the time-of-day multiplier;
  // falls back to the line's single representative dwell when no per-station array exists
  const dwellArr = schedule?.dwellByIdx
  const dwellAt = (travelIdx: number): number => {
    const base =
      dwellArr && dwellArr.length === nSt
        ? dwellArr[direction === 0 ? travelIdx : nSt - 1 - travelIdx]
        : (schedule?.dwellSec ?? 25)
    return Math.round(base * mq)
  }

  // direction 0: segments as-is; direction 1: reversed order + reversed geometry
  const ordered = direction === 0 ? segs : segs.slice().reverse()
  const legs: Leg[] = ordered.map((s) => {
    const geometry = direction === 0 ? s.geometry : s.geometry.slice().reverse()
    return {
      geometry,
      cum: cumulativeDistances(geometry),
      lengthM: s.lengthM,
      runTimeS: s.runTimeS ?? Math.max(25, Math.round(s.lengthM / 12.5 + 14)),
      fromId: direction === 0 ? s.from : s.to,
      toId: direction === 0 ? s.to : s.from,
    }
  })

  const arrive: number[] = [0]
  const depart: number[] = [0]
  for (let i = 0; i < legs.length; i++) {
    const arr = depart[i] + legs[i].runTimeS
    arrive.push(arr)
    const isLast = i === legs.length - 1
    depart.push(isLast ? arr : arr + dwellAt(i + 1))
  }

  const stationCoord: LngLat[] = []
  const stationIds: StationId[] = []
  if (legs.length) {
    stationCoord.push(legs[0].geometry[0])
    stationIds.push(legs[0].fromId)
    for (const leg of legs) {
      stationCoord.push(leg.geometry[leg.geometry.length - 1])
      stationIds.push(leg.toId)
    }
  }

  const plan: TripPlan = {
    lineId,
    direction,
    legs,
    arrive,
    depart,
    cycleSec: arrive[arrive.length - 1] || 0,
    stationCoord,
    stationIds,
    cruiseMps: cal?.cruiseMps,
    aAcc: cal?.aAcc,
    aDec: cal?.aDec,
  }
  planCache.set(cacheKey, plan)
  return plan
}

// ---------------------------------------------------------------------------
// kinematics: time-of-day dwell multiplier + asymmetric intra-segment position
// ---------------------------------------------------------------------------
// Rush-hour dwell stretch: dual peak (~07:30–09:00, 17:00–19:00) + night trough,
// piecewise-linear, quantized to 0.05 so buildPlan caches a handful of plans per day.
// Late-evening İstanbul metros stay busy (people heading home), so dwell is held near 1.0
// well past 22:00 — especially at transfer hubs — and only troughs after midnight, rather
// than dropping off in the early evening as before.
const PEAK_PROFILE: Record<'weekday' | 'weekend', [number, number][]> = {
  weekday: [[0, 0.85], [5, 0.88], [6.5, 0.95], [7.5, 1.2], [9, 1.2], [10, 1.0], [16, 1.0], [17, 1.2], [19, 1.2], [21, 1.08], [23, 1.0], [24, 0.9]],
  weekend: [[0, 0.88], [8, 0.95], [11, 1.05], [18, 1.1], [22, 1.05], [23.5, 0.97], [24, 0.9]],
}
export function dwellMultiplier(nowMs: number): number {
  const d = new Date(nowMs)
  const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
  const pts = dayType(d) === 'weekday' ? PEAK_PROFILE.weekday : PEAK_PROFILE.weekend
  let m = pts[pts.length - 1][1]
  for (let i = 1; i < pts.length; i++) {
    if (h <= pts[i][0]) {
      const [h0, v0] = pts[i - 1]
      const [h1, v1] = pts[i]
      m = v0 + (v1 - v0) * ((h - h0) / Math.max(1e-6, h1 - h0))
      break
    }
  }
  return Math.round(m * 20) / 20
}

// Fraction of a segment's distance covered at time-fraction `tf`, following an
// asymmetric trapezoidal/triangular speed profile (accelerate at aAcc, brake harder at
// aDec). Stretched to the leg's actual duration; returns `tf` (linear) if uncalibrated.
function kinDistFrac(tf: number, d: number, V: number, aAcc: number, aDec: number): number {
  if (!(V > 0) || !(d > 0) || !(aAcc > 0) || !(aDec > 0)) return tf
  const dAcc = (V * V) / (2 * aAcc)
  const dDec = (V * V) / (2 * aDec)
  let T: number
  let distAt: (t: number) => number
  if (dAcc + dDec <= d) {
    // trapezoid: reaches cruise
    const tAcc = V / aAcc
    const tDec = V / aDec
    const dCru = d - dAcc - dDec
    const tCru = dCru / V
    T = tAcc + tCru + tDec
    distAt = (t) => {
      if (t <= tAcc) return 0.5 * aAcc * t * t
      if (t <= tAcc + tCru) return dAcc + V * (t - tAcc)
      const tb = t - tAcc - tCru
      return dAcc + dCru + V * tb - 0.5 * aDec * tb * tb
    }
  } else {
    // triangle: too short to reach cruise
    const vp = Math.sqrt((2 * d) / (1 / aAcc + 1 / aDec))
    const tAcc = vp / aAcc
    const tDec = vp / aDec
    const dA = 0.5 * aAcc * tAcc * tAcc
    T = tAcc + tDec
    distAt = (t) => {
      if (t <= tAcc) return 0.5 * aAcc * t * t
      const tb = t - tAcc
      return dA + vp * tb - 0.5 * aDec * tb * tb
    }
  }
  const dist = distAt(Math.max(0, Math.min(T, tf * T)))
  return Math.max(0, Math.min(1, dist / d))
}

// ---------------------------------------------------------------------------
// departures (memoized per line+dayType) — both directions share the schedule
// ---------------------------------------------------------------------------
const departureCache = new Map<string, number[]>()

function departures(net: RailNetwork, lineId: LineId, dt: ServiceDayType): number[] {
  const cacheKey = `${lineId}:${dt}`
  const cached = departureCache.get(cacheKey)
  if (cached) return cached

  const schedule = net.schedules[lineId]
  const bands = (schedule?.bands?.[dt] ?? []).slice().sort((a, b) => a.startMin - b.startMin)
  const deps: number[] = []
  if (bands.length) {
    let tSec = bands[0].startMin * 60
    const endSec = bands[bands.length - 1].endMin * 60
    let guard = 0
    while (tSec < endSec && guard++ < 10_000) {
      const minute = tSec / 60
      const band = bands.find((b) => minute >= b.startMin && minute < b.endMin)
      if (!band) {
        const next = bands.find((b) => b.startMin * 60 > tSec)
        if (!next) break
        tSec = next.startMin * 60
        continue
      }
      deps.push(tSec)
      tSec += band.headwaySec
    }
  }
  departureCache.set(cacheKey, deps)
  return deps
}

// ---------------------------------------------------------------------------
// positioning
// ---------------------------------------------------------------------------
function positionAt(plan: TripPlan, elapsed: number, departSec: number): TrainSnapshot | null {
  if (elapsed < 0 || elapsed > plan.cycleSec + 5) return null
  const { arrive, depart, legs } = plan

  // locate the current station/leg
  for (let i = 0; i < legs.length; i++) {
    // dwelling at station i: [arrive_i, depart_i)
    if (elapsed >= arrive[i] && elapsed < depart[i]) {
      return makeSnapshot(plan, i, 0, plan.stationCoord[i], plan.stationCoord[i + 1], departSec, 'dwelling', arrive[i + 1] - elapsed)
    }
    // running on leg i: [depart_i, arrive_{i+1})
    if (elapsed >= depart[i] && elapsed < arrive[i + 1]) {
      const leg = legs[i]
      const tf = (elapsed - depart[i]) / Math.max(1, leg.runTimeS)
      // asymmetric accelerate→cruise→brake profile (linear if the line is uncalibrated)
      const df = plan.cruiseMps ? kinDistFrac(tf, leg.lengthM, plan.cruiseMps, plan.aAcc!, plan.aDec!) : tf
      const dist = df * leg.lengthM
      const p = pointAtDistance(leg.geometry, dist, leg.cum)
      return {
        id: `${plan.lineId}:${plan.direction}:${Math.round(departSec)}`,
        lineId: plan.lineId,
        direction: plan.direction,
        coord: p.coord,
        bearing: p.bearing,
        phase: 'running',
        fromStation: leg.fromId,
        toStation: leg.toId,
        segmentProgress: df,
        etaNextSec: Math.max(0, arrive[i + 1] - elapsed),
      }
    }
  }
  // arrived at terminus
  const lastIdx = legs.length
  return makeSnapshot(
    plan,
    lastIdx,
    0,
    plan.stationCoord[lastIdx] ?? plan.stationCoord[lastIdx - 1],
    plan.stationCoord[lastIdx] ?? plan.stationCoord[lastIdx - 1],
    departSec,
    'dwelling',
    0,
  )
}

function makeSnapshot(
  plan: TripPlan,
  stationIdx: number,
  frac: number,
  coord: LngLat,
  nextCoord: LngLat,
  departSec: number,
  phase: 'dwelling' | 'running',
  etaNextSec: number,
): TrainSnapshot {
  const legs = plan.legs
  const leg = legs[Math.min(stationIdx, legs.length - 1)]
  const dx = nextCoord[0] - coord[0]
  const dy = nextCoord[1] - coord[1]
  const bearing = dx === 0 && dy === 0 ? 0 : (Math.atan2(dx, dy) * 180) / Math.PI
  return {
    id: `${plan.lineId}:${plan.direction}:${Math.round(departSec)}`,
    lineId: plan.lineId,
    direction: plan.direction,
    coord,
    bearing: (bearing + 360) % 360,
    phase,
    fromStation: stationIdx < legs.length ? leg.fromId : legs[legs.length - 1].toId,
    toStation: stationIdx < legs.length ? leg.toId : legs[legs.length - 1].toId,
    segmentProgress: frac,
    etaNextSec,
  }
}

// ---------------------------------------------------------------------------
// public: simulate the whole network at an instant
// ---------------------------------------------------------------------------
export interface SimulateOptions {
  network?: RailNetwork
  /** Restrict to these lines (default: all). */
  lineIds?: LineId[]
}

export function simulate(nowMs: number, opts: SimulateOptions = {}): NetworkSnapshot {
  const net = opts.network ?? defaultNetwork
  const date = new Date(nowMs)
  const dt = dayType(date)
  const nowSec = secondsSinceMidnight(date)
  const dwellMult = dwellMultiplier(nowMs)
  const ids = opts.lineIds ?? Object.keys(net.lines)

  const trains: TrainSnapshot[] = []
  const countByLine: Record<LineId, number> = {}

  for (const lineId of ids) {
    if (!net.segments[lineId]?.length) continue
    const deps = departures(net, lineId, dt)
    let count = 0
    for (const direction of [0, 1] as Direction[]) {
      const plan = buildPlan(net, lineId, direction, dwellMult)
      if (!plan.legs.length) continue
      for (const D of deps) {
        // a train departing at D today, and one that departed late "yesterday"
        const candidates = [nowSec - D, nowSec + SECONDS_PER_DAY - D]
        for (const elapsed of candidates) {
          const snap = positionAt(plan, elapsed, D)
          if (snap) {
            trains.push(snap)
            count++
            break
          }
        }
      }
    }
    countByLine[lineId] = count
  }

  return { t: nowMs, trains, countByLine }
}

/** Number of active trains on a line right now (cheap helper for line lists). */
export function activeTrainCount(nowMs: number, lineId: LineId, net: RailNetwork = defaultNetwork): number {
  return simulate(nowMs, { network: net, lineIds: [lineId] }).countByLine[lineId] ?? 0
}

export interface Arrival {
  lineId: LineId
  direction: Direction
  /** Terminus the arriving train is heading toward. */
  towardId: StationId
  /** Seconds until the next scheduled arrival at the queried station. */
  etaSec: number
}

/**
 * Next scheduled arrivals at a station, per line+direction, within the next hour.
 * Derived from the same headway model as the live map (scheduled, not GPS).
 */
export function nextArrivals(
  nowMs: number,
  stationId: StationId,
  net: RailNetwork = defaultNetwork,
): Arrival[] {
  const date = new Date(nowMs)
  const dt = dayType(date)
  const nowSec = secondsSinceMidnight(date)
  const dwellMult = dwellMultiplier(nowMs)
  const out: Arrival[] = []

  for (const lineId of Object.keys(net.lines)) {
    const line = net.lines[lineId]
    const idx = line.stations.indexOf(stationId)
    if (idx < 0 || !net.segments[lineId]?.length) continue
    const deps = departures(net, lineId, dt)
    if (!deps.length) continue
    const n = line.stations.length

    for (const direction of [0, 1] as Direction[]) {
      const plan = buildPlan(net, lineId, direction, dwellMult)
      const sIdx = direction === 0 ? idx : n - 1 - idx
      if (sIdx < 0 || sIdx >= plan.arrive.length) continue
      const offset = plan.arrive[sIdx]
      let best = Infinity
      for (const D of deps) {
        for (const base of [D, D - SECONDS_PER_DAY]) {
          const eta = base + offset - nowSec
          if (eta >= 0 && eta < best) best = eta
        }
      }
      if (best !== Infinity && best <= 3600) {
        out.push({
          lineId,
          direction,
          towardId: direction === 0 ? line.stations[n - 1] : line.stations[0],
          etaSec: best,
        })
      }
    }
  }
  return out.sort((a, b) => a.etaSec - b.etaSec)
}

export interface AtPlatform {
  lineId: LineId
  direction: Direction
  /** Terminus this train is heading toward. */
  towardId: StationId
  /** Seconds of dwell left before it departs (doors-open window). */
  departSec: number
}

/**
 * Trains that are dwelling at a station RIGHT NOW ("şu an peronda" / at the platform),
 * per line+direction — derived from the same deterministic model as the live map. A
 * train counts as at-platform while wall-clock time is inside its [arrive, depart) dwell
 * window for this station. (Pure terminus arrivals have no dwell window, so are omitted.)
 */
export function trainsAtPlatform(
  nowMs: number,
  stationId: StationId,
  net: RailNetwork = defaultNetwork,
): AtPlatform[] {
  const date = new Date(nowMs)
  const dt = dayType(date)
  const nowSec = secondsSinceMidnight(date)
  const dwellMult = dwellMultiplier(nowMs)
  const out: AtPlatform[] = []

  for (const lineId of Object.keys(net.lines)) {
    const line = net.lines[lineId]
    const idx = line.stations.indexOf(stationId)
    if (idx < 0 || !net.segments[lineId]?.length) continue
    const deps = departures(net, lineId, dt)
    if (!deps.length) continue
    const n = line.stations.length

    for (const direction of [0, 1] as Direction[]) {
      const plan = buildPlan(net, lineId, direction, dwellMult)
      const sIdx = direction === 0 ? idx : n - 1 - idx
      if (sIdx < 0 || sIdx >= plan.arrive.length) continue
      const arr = plan.arrive[sIdx]
      const dep = plan.depart[sIdx]
      if (dep <= arr) continue // no dwell window here (terminus)
      let found = false
      for (const D of deps) {
        if (found) break
        for (const base of [D, D - SECONDS_PER_DAY]) {
          const elapsed = nowSec - base
          if (elapsed >= arr && elapsed < dep) {
            out.push({
              lineId,
              direction,
              towardId: direction === 0 ? line.stations[n - 1] : line.stations[0],
              departSec: Math.max(1, Math.round(dep - elapsed)),
            })
            found = true
            break
          }
        }
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// single-train detail (for the "track this train" panel)
// ---------------------------------------------------------------------------
export interface TrainStopEta {
  stationId: StationId
  /** Seconds until this train reaches the stop (0 = arriving now). */
  etaSec: number
}

export interface TrainDetail {
  id: string
  lineId: LineId
  direction: Direction
  /** Terminus this train is heading toward. */
  towardId: StationId
  /** Station last departed / dwelling at. */
  fromStation: StationId
  /** Next station. */
  toStation: StationId
  phase: TrainPhase
  coord: LngLat
  bearing: number
  /** Seconds until {@link toStation}. */
  etaNextSec: number
  /** Remaining stops from the next one to the terminus, with ETA from now. */
  upcoming: TrainStopEta[]
}

/**
 * Re-derive a single train's live state from its deterministic id
 * (`${lineId}:${direction}:${departSec}`), including the list of upcoming stops
 * with ETAs. Returns null when that train is no longer in service at `nowMs`.
 */
export function trainDetailById(
  nowMs: number,
  id: string,
  net: RailNetwork = defaultNetwork,
): TrainDetail | null {
  const parts = id.split(':')
  if (parts.length < 3) return null
  const lineId = parts[0]
  const direction = (Number(parts[1]) === 1 ? 1 : 0) as Direction
  const departSec = Number(parts[2])
  if (Number.isNaN(departSec) || !net.segments[lineId]?.length) return null

  const plan = buildPlan(net, lineId, direction, dwellMultiplier(nowMs))
  if (!plan.legs.length) return null

  const nowSec = secondsSinceMidnight(new Date(nowMs))
  let snap: TrainSnapshot | null = null
  let elapsed = 0
  for (const e of [nowSec - departSec, nowSec + SECONDS_PER_DAY - departSec]) {
    const s = positionAt(plan, e, departSec)
    if (s) {
      snap = s
      elapsed = e
      break
    }
  }
  if (!snap) return null

  const upcoming: TrainStopEta[] = []
  for (let i = 0; i < plan.stationIds.length; i++) {
    const eta = plan.arrive[i] - elapsed
    // keep stations not yet reached (allow a tiny negative slack for the one being reached now)
    if (eta > -1) upcoming.push({ stationId: plan.stationIds[i], etaSec: Math.max(0, eta) })
  }

  return {
    id,
    lineId,
    direction,
    towardId: plan.stationIds[plan.stationIds.length - 1],
    fromStation: snap.fromStation,
    toStation: snap.toStation,
    phase: snap.phase,
    coord: snap.coord,
    bearing: snap.bearing,
    etaNextSec: snap.etaNextSec,
    upcoming,
  }
}
