/**
 * A→B journey planning over the rail network: rides + walking transfers, with
 * realistic boarding/transfer waits derived from the current service frequency.
 * Time-dependent (uses the headway band active at `nowMs`).
 */
import type { LineId, StationId } from '@/lib/network/types'
import { network } from '@/data'
import { currentHeadwaySec } from '@/lib/stats'

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
export type JourneyLeg = RideLeg | WalkLeg

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

export function planJourney(origin: StationId, dest: StationId, nowMs: number): Journey | null {
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
    (sum, l) => sum + (l.type === 'walk' ? l.walkSec : l.rideSec + l.waitSec),
    0,
  )
  const transfers = legs.filter((l) => l.type === 'ride').length - 1
  return { legs, totalSec, transfers: Math.max(0, transfers) }
}
