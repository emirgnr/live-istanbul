/**
 * A→B journey planning over the rail network: rides + walking transfers, with
 * realistic boarding/transfer waits derived from the current service frequency.
 * Time-dependent (uses the headway band active at `nowMs`).
 */
import type { LineId, LngLat, StationId } from '@/lib/network/types'
import { network, allStations, getStation } from '@/data'
import { currentHeadwaySec } from '@/lib/stats'
import { haversineMeters } from '@/lib/geo'

interface RideEdge {
  to: StationId
  lineId: LineId
  sec: number
}

// ride graph (built once): station → adjacent stations per line
const rideAdj = new Map<StationId, RideEdge[]>()
const walkAdj = new Map<StationId, { to: StationId; sec: number }[]>()

function buildGraph() {
  if (rideAdj.size) return
  for (const code of Object.keys(network.lines)) {
    if (network.lines[code].hidden) continue // hidden sub-lines duplicate the parent's edges
    const ids = network.lines[code].stations
    const dwell = network.schedules[code]?.dwellSec ?? 25
    const segs = network.segments[code] ?? []
    for (let i = 0; i < segs.length; i++) {
      const sec = (segs[i].runTimeS ?? 60) + dwell
      const a = ids[i]
      const b = ids[i + 1]
      ;(rideAdj.get(a) ?? rideAdj.set(a, []).get(a)!).push({ to: b, lineId: code, sec })
      ;(rideAdj.get(b) ?? rideAdj.set(b, []).get(b)!).push({ to: a, lineId: code, sec })
    }
  }
  for (const t of network.transfers ?? []) {
    ;(walkAdj.get(t.a) ?? walkAdj.set(t.a, []).get(t.a)!).push({ to: t.b, sec: t.walkSec })
    ;(walkAdj.get(t.b) ?? walkAdj.set(t.b, []).get(t.b)!).push({ to: t.a, sec: t.walkSec })
  }
}

// small binary min-heap keyed by cost
class Heap {
  private a: { k: string; c: number }[] = []
  push(k: string, c: number) {
    const a = this.a
    a.push({ k, c })
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p].c <= a[i].c) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop() {
    const a = this.a
    if (!a.length) return undefined
    const top = a[0]
    const last = a.pop()!
    if (a.length) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l].c < a[m].c) m = l
        if (r < a.length && a[r].c < a[m].c) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
  get size() {
    return this.a.length
  }
}

export interface RideLeg {
  type: 'ride'
  lineId: LineId
  from: StationId
  to: StationId
  stops: number
  rideSec: number
  waitSec: number
  stationIds: StationId[]
}
export interface WalkLeg {
  type: 'walk'
  from: StationId
  to: StationId
  walkSec: number
}
/** Walking between an off-network place (address/POI/your location) and a station. */
export interface AccessLeg {
  type: 'access'
  /** 'origin' = place→station, 'dest' = station→place, 'direct' = place→place. */
  dir: 'origin' | 'dest' | 'direct'
  /** Name of the off-network place. */
  label: string
  placeCoord: LngLat
  /** The station end (null for a direct place→place walk). */
  stationId: StationId | null
  /** Coordinate of the other end (the station, or the destination place for 'direct'). */
  otherCoord: LngLat
  walkSec: number
}
export type JourneyLeg = RideLeg | WalkLeg | AccessLeg

export interface Journey {
  legs: JourneyLeg[]
  totalSec: number
  transfers: number
}

const KEY = (s: StationId, l: LineId | null) => `${s}|${l ?? '-'}`

interface PrevEdge {
  from: string
  lineId: LineId | null
  kind: 'ride' | 'walk'
  sec: number
  wait: number
  toStation: StationId
  fromStation: StationId
}

export function planJourney(
  origin: StationId,
  dest: StationId,
  nowMs: number,
  banLines?: Set<LineId>,
): Journey | null {
  buildGraph()
  if (origin === dest) return { legs: [], totalSec: 0, transfers: 0 }

  const waitCache = new Map<LineId, number>()
  const wait = (l: LineId): number => {
    if (waitCache.has(l)) return waitCache.get(l)!
    const hw = currentHeadwaySec(l, nowMs)
    const w = hw == null ? Infinity : Math.min(hw / 2, 600)
    waitCache.set(l, w)
    return w
  }

  const dist = new Map<string, number>()
  const prev = new Map<string, PrevEdge>()
  const heap = new Heap()
  const start = KEY(origin, null)
  dist.set(start, 0)
  heap.push(start, 0)

  let endKey: string | null = null
  while (heap.size) {
    const top = heap.pop()!
    const [s, lRaw] = top.k.split('|')
    const curLine = lRaw === '-' ? null : lRaw
    if (top.c > (dist.get(top.k) ?? Infinity)) continue
    if (s === dest) {
      endKey = top.k
      break
    }
    // ride
    for (const e of rideAdj.get(s) ?? []) {
      if (banLines?.has(e.lineId)) continue
      const w = curLine === e.lineId ? 0 : wait(e.lineId)
      if (!isFinite(w)) continue
      const nc = top.c + w + e.sec
      const nk = KEY(e.to, e.lineId)
      if (nc < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nc)
        prev.set(nk, { from: top.k, lineId: e.lineId, kind: 'ride', sec: e.sec, wait: w, toStation: e.to, fromStation: s })
        heap.push(nk, nc)
      }
    }
    // walk (only from a boarded/҂start state, and not consecutive walks)
    if (curLine !== 'WALK') {
      for (const e of walkAdj.get(s) ?? []) {
        const nc = top.c + e.sec
        const nk = KEY(e.to, 'WALK' as LineId)
        if (nc < (dist.get(nk) ?? Infinity)) {
          dist.set(nk, nc)
          prev.set(nk, { from: top.k, lineId: null, kind: 'walk', sec: e.sec, wait: 0, toStation: e.to, fromStation: s })
          heap.push(nk, nc)
        }
      }
    }
  }

  if (!endKey) return null

  // reconstruct edges
  const edges: PrevEdge[] = []
  let k: string | undefined = endKey
  while (k && prev.has(k)) {
    const p: PrevEdge = prev.get(k)!
    edges.unshift(p)
    k = p.from
  }
  if (!edges.length) return null

  // group into legs
  const legs: JourneyLeg[] = []
  let i = 0
  while (i < edges.length) {
    const e = edges[i]
    if (e.kind === 'walk') {
      legs.push({ type: 'walk', from: e.fromStation, to: e.toStation, walkSec: e.sec })
      i++
      continue
    }
    // accumulate consecutive ride edges on the same line
    const lineId = e.lineId!
    const stationIds = [e.fromStation]
    let rideSec = 0
    const waitSec = e.wait
    let j = i
    while (j < edges.length && edges[j].kind === 'ride' && edges[j].lineId === lineId) {
      rideSec += edges[j].sec
      stationIds.push(edges[j].toStation)
      j++
    }
    legs.push({
      type: 'ride',
      lineId,
      from: stationIds[0],
      to: stationIds[stationIds.length - 1],
      stops: stationIds.length - 1,
      rideSec,
      waitSec,
      stationIds,
    })
    i = j
  }

  const totalSec = legs.reduce(
    (sum, l) => sum + (l.type === 'ride' ? l.rideSec + l.waitSec : l.walkSec),
    0,
  )
  const transfers = legs.filter((l) => l.type === 'ride').length - 1
  return { legs, totalSec, transfers: Math.max(0, transfers) }
}

// ---------------------------------------------------------------------------
// place-aware planning: route from/to arbitrary places, not just stations
// ---------------------------------------------------------------------------

/** A journey endpoint: a network station, or an off-network place/address/location. */
export type JourneyPoint =
  | { kind: 'station'; id: StationId; label: string }
  | { kind: 'place'; coord: LngLat; label: string }

const WALK_MPS = 1.35
const walkSecBetween = (a: LngLat, b: LngLat): number =>
  Math.round(haversineMeters(a, b) / WALK_MPS)

/** Ids of the k stations nearest to a coordinate. */
function nearestStations(coord: LngLat, k: number): StationId[] {
  return allStations()
    .map((s) => ({ id: s.id, d: haversineMeters(coord, s.coord) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map((x) => x.id)
}

const pointCoord = (p: JourneyPoint): LngLat | null =>
  p.kind === 'place' ? p.coord : (getStation(p.id)?.coord ?? null)

/**
 * Plan A→B where A and B may be stations OR arbitrary places. Places resolve to
 * their nearest stations (a few candidates are tried, the best total wins) and the
 * walk from/to the place is added as an access leg. A pure walk is returned when
 * that beats transit (e.g. the two places are close together).
 */
export function planJourneyPoints(
  from: JourneyPoint,
  to: JourneyPoint,
  nowMs: number,
  banLines?: Set<LineId>,
): Journey | null {
  const K = 3
  const oStations = from.kind === 'station' ? [from.id] : nearestStations(from.coord, K)
  const dStations = to.kind === 'station' ? [to.id] : nearestStations(to.coord, K)
  const oCoord = pointCoord(from)
  const dCoord = pointCoord(to)

  let best:
    | { j: Journey; o: StationId; d: StationId; access: number; egress: number; total: number }
    | null = null
  for (const o of oStations) {
    for (const d of dStations) {
      const oc = getStation(o)?.coord
      const dc = getStation(d)?.coord
      if (!oc || !dc) continue
      const access = from.kind === 'place' ? walkSecBetween(from.coord, oc) : 0
      const egress = to.kind === 'place' ? walkSecBetween(dc, to.coord) : 0
      const j = o === d ? { legs: [], totalSec: 0, transfers: 0 } : planJourney(o, d, nowMs, banLines)
      if (!j) continue
      const total = j.totalSec + access + egress
      if (!best || total < best.total) best = { j, o, d, access, egress, total }
    }
  }

  // pure-walk option (only when a place is involved) — wins for short hops
  const anyPlace = from.kind === 'place' || to.kind === 'place'
  if (anyPlace && oCoord && dCoord) {
    const dw = walkSecBetween(oCoord, dCoord)
    if (!best || dw < best.total) {
      return {
        legs: [
          {
            type: 'access',
            dir: 'direct',
            label: to.label,
            placeCoord: oCoord,
            stationId: null,
            otherCoord: dCoord,
            walkSec: dw,
          },
        ],
        totalSec: dw,
        transfers: 0,
      }
    }
  }

  if (!best) return null

  const legs: JourneyLeg[] = []
  if (from.kind === 'place' && best.access > 5) {
    legs.push({
      type: 'access',
      dir: 'origin',
      label: from.label,
      placeCoord: from.coord,
      stationId: best.o,
      otherCoord: getStation(best.o)!.coord,
      walkSec: best.access,
    })
  }
  legs.push(...best.j.legs)
  if (to.kind === 'place' && best.egress > 5) {
    legs.push({
      type: 'access',
      dir: 'dest',
      label: to.label,
      placeCoord: to.coord,
      stationId: best.d,
      otherCoord: getStation(best.d)!.coord,
      walkSec: best.egress,
    })
  }
  return { legs, totalSec: best.total, transfers: best.j.transfers }
}

/**
 * Several distinct A→B options (fastest first). Alternatives are produced by banning the line(s) the
 * fastest route uses and replanning, so the user sees genuinely different transfer choices (e.g. the
 * direct ride vs. a Metrobüs variant). De-duplicated by their ride-line sequence.
 */
export function planAlternatives(
  from: JourneyPoint,
  to: JourneyPoint,
  nowMs: number,
  k = 3,
): Journey[] {
  const out: Journey[] = []
  const seen = new Set<string>()
  const rideLines = (j: Journey) =>
    j.legs.filter((l): l is RideLeg => l.type === 'ride').map((l) => l.lineId)
  const add = (j: Journey | null) => {
    if (!j) return
    const lines = rideLines(j)
    if (!lines.length) return
    const sig = lines.join('>')
    if (seen.has(sig)) return
    seen.add(sig)
    out.push(j)
  }

  const base = planJourneyPoints(from, to, nowMs)
  add(base)
  if (base) {
    const lines = rideLines(base)
    for (const l of lines) add(planJourneyPoints(from, to, nowMs, new Set([l])))
    for (let i = 0; i < lines.length && out.length < k + 4; i++) {
      for (let j = i + 1; j < lines.length && out.length < k + 4; j++) {
        add(planJourneyPoints(from, to, nowMs, new Set([lines[i], lines[j]])))
      }
    }
  }
  return out.sort((a, b) => a.totalSec - b.totalSec).slice(0, k)
}
