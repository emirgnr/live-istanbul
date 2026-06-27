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

function buildPlan(net: RailNetwork, lineId: LineId, direction: Direction): TripPlan {
  const cacheKey = `${lineId}:${direction}`
  const cached = planCache.get(cacheKey)
  if (cached) return cached

  const schedule = net.schedules[lineId]
  const dwell = schedule?.dwellSec ?? 25
  const segs = net.segments[lineId] ?? []

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
    depart.push(isLast ? arr : arr + dwell)
  }

  const stationCoord: LngLat[] = []
  if (legs.length) {
    stationCoord.push(legs[0].geometry[0])
    for (const leg of legs) stationCoord.push(leg.geometry[leg.geometry.length - 1])
  }

  const plan: TripPlan = {
    lineId,
    direction,
    legs,
    arrive,
    depart,
    cycleSec: arrive[arrive.length - 1] || 0,
    stationCoord,
  }
  planCache.set(cacheKey, plan)
  return plan
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
      const frac = (elapsed - depart[i]) / Math.max(1, legs[i].runTimeS)
      const dist = frac * legs[i].lengthM
      const p = pointAtDistance(legs[i].geometry, dist, legs[i].cum)
      return {
        id: `${plan.lineId}:${plan.direction}:${Math.round(departSec)}`,
        lineId: plan.lineId,
        direction: plan.direction,
        coord: p.coord,
        bearing: p.bearing,
        phase: 'running',
        fromStation: legs[i].fromId,
        toStation: legs[i].toId,
        segmentProgress: frac,
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
  const ids = opts.lineIds ?? Object.keys(net.lines)

  const trains: TrainSnapshot[] = []
  const countByLine: Record<LineId, number> = {}

  for (const lineId of ids) {
    if (!net.segments[lineId]?.length) continue
    const deps = departures(net, lineId, dt)
    let count = 0
    for (const direction of [0, 1] as Direction[]) {
      const plan = buildPlan(net, lineId, direction)
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
  const out: Arrival[] = []

  for (const lineId of Object.keys(net.lines)) {
    const line = net.lines[lineId]
    const idx = line.stations.indexOf(stationId)
    if (idx < 0 || !net.segments[lineId]?.length) continue
    const deps = departures(net, lineId, dt)
    if (!deps.length) continue
    const n = line.stations.length

    for (const direction of [0, 1] as Direction[]) {
      const plan = buildPlan(net, lineId, direction)
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
