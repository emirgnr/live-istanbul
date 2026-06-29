/**
 * Relational model of the scheme, derived purely from its own geometry (metroData) — independent of
 * our simulated network. Every dot is its own node tied to exactly one line (a colour + connected
 * component, so M8 vs T1 — same blue — and the M9 vs Marmaray "Ataköy" become distinct). We also
 * compute each node's on-line neighbours and its interchange links (nearby dots of other lines), so
 * the scheme can show per-station, per-line info and transfers without leaning on the map's
 * name-merge.
 */
import { BADGES, SEGMENTS, STATIONS, type MetroStation } from './metroData'

export interface SchemeNode {
  id: string
  x: number
  y: number
  color: string
  name: string
  /** Scheme line id (colour + connected component). */
  lineId: string
  /** Adjacent node ids on the same line. */
  neighbors: string[]
  /** Node ids of other lines that interchange here. */
  transfers: string[]
}

export interface SchemeLine {
  id: string
  color: string
  /** Official line code(s) sitting on this component, e.g. ["M1A","M1B"] or ["M9"]. */
  codes: string[]
  /** Terminus-to-terminus label. */
  name: string
  /** Member node ids, in travel order (best-effort). */
  nodeIds: string[]
}

const TOUCH = 8 * 8 // a segment endpoint within 8px of a same-colour dot snaps to it
const TRANSFER = 60 * 60 // dots of different lines within 60px interchange

const byColor: Record<string, MetroStation[]> = {}
for (const s of STATIONS) (byColor[s.color] ??= []).push(s)

const nearestOfColor = (x: number, y: number, color: string, max2 = TOUCH): MetroStation | null => {
  let best: MetroStation | null = null
  let bd = max2
  for (const n of byColor[color] ?? []) {
    const dx = n.x - x
    const dy = n.y - y
    const d = dx * dx + dy * dy
    if (d <= bd) {
      bd = d
      best = n
    }
  }
  return best
}

const firstLastPoint = (d: string): [number, number, number, number] | null => {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)
  if (!nums || nums.length < 4) return null
  return [+nums[0], +nums[1], +nums[nums.length - 2], +nums[nums.length - 1]]
}

// adjacency (same-colour, via the drawn segments) + per-segment line resolution + edge geometry
const adj: Record<string, Set<string>> = {}
for (const s of STATIONS) adj[s.id] = new Set()
const segNode: (string | null)[] = [] // an endpoint node id per segment (to map a tapped segment → line)
const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
const edgeSeg: Record<string, string> = {} // node-pair -> the drawn segment's path data (for route highlight)
for (const seg of SEGMENTS) {
  const pts = firstLastPoint(seg.d)
  if (!pts) {
    segNode.push(null)
    continue
  }
  const a = nearestOfColor(pts[0], pts[1], seg.color)
  const b = nearestOfColor(pts[2], pts[3], seg.color)
  segNode.push(a?.id ?? b?.id ?? null)
  if (a && b && a.id !== b.id) {
    adj[a.id].add(b.id)
    adj[b.id].add(a.id)
    edgeSeg[edgeKey(a.id, b.id)] = seg.d
  }
}

/** The drawn path data between two adjacent nodes (for highlighting a planned route on real lines). */
export const edgeD = (a: string, b: string): string | null => edgeSeg[edgeKey(a, b)] ?? null

// connected components (= line instances). adjacency only links same colour, so components split
// shared colours by connectivity.
const compOf: Record<string, number> = {}
let nComp = 0
for (const s of STATIONS) {
  if (compOf[s.id] !== undefined) continue
  const id = nComp++
  const stack = [s.id]
  compOf[s.id] = id
  while (stack.length) {
    const cur = stack.pop() as string
    for (const nb of adj[cur]) {
      if (compOf[nb] === undefined) {
        compOf[nb] = id
        stack.push(nb)
      }
    }
  }
}

const stationById: Record<string, MetroStation> = {}
for (const s of STATIONS) stationById[s.id] = s

const compMembers: Record<number, string[]> = {}
for (const s of STATIONS) (compMembers[compOf[s.id]] ??= []).push(s.id)

// codes per component (snap each line badge to the nearest dot of its colour)
const compCodes: Record<number, string[]> = {}
for (const b of BADGES) {
  // a badge chip sits offset from its terminus — snap to the nearest dot of its colour, no tight cap
  const n = nearestOfColor(b.x, b.y, b.color, Infinity)
  if (!n) continue
  const c = compOf[n.id]
  ;(compCodes[c] ??= [])
  if (!compCodes[c].includes(b.code)) compCodes[c].push(b.code)
}

// Group components that are really the SAME line: identical code-set, or (when un-badged, e.g.
// Marmaray / Metrobüs) identical colour. This re-joins a line the source drew in disconnected
// pieces (a small gap split M7 / M2 into two components) so it reads as one line.
const groupKeyOf = (c: number) =>
  compCodes[c]?.length ? [...compCodes[c]].sort().join('/') : stationById[compMembers[c][0]].color
const groupIdByKey: Record<string, string> = {}
const lineOfComp: Record<number, string> = {}
let nGroup = 0
for (const c of Object.keys(compMembers).map(Number)) {
  const key = groupKeyOf(c)
  groupIdByKey[key] ??= `L${nGroup++}`
  lineOfComp[c] = groupIdByKey[key]
}
const lineOf = (id: string) => lineOfComp[compOf[id]]

// nodes
export const nodeById: Record<string, SchemeNode> = {}
for (const s of STATIONS) {
  nodeById[s.id] = {
    id: s.id,
    x: s.x,
    y: s.y,
    color: s.color,
    name: s.name,
    lineId: lineOf(s.id),
    neighbors: [...adj[s.id]],
    transfers: [],
  }
}

// interchange links: dots of *different* lines (groups) that sit close together
for (let i = 0; i < STATIONS.length; i++) {
  for (let j = i + 1; j < STATIONS.length; j++) {
    const a = STATIONS[i]
    const b = STATIONS[j]
    if (lineOf(a.id) === lineOf(b.id)) continue
    const dx = a.x - b.x
    const dy = a.y - b.y
    if (dx * dx + dy * dy <= TRANSFER) {
      nodeById[a.id].transfers.push(b.id)
      nodeById[b.id].transfers.push(a.id)
    }
  }
}

/** Order a line's nodes terminus→terminus (best-effort DFS from a degree-1 end; disconnected
 *  pieces are appended). */
function ordered(ids: string[]): string[] {
  const set = new Set(ids)
  const start = ids.find((id) => adj[id].size === 1) ?? ids[0]
  const seen = new Set<string>()
  const out: string[] = []
  const stack = [start]
  while (stack.length) {
    const cur = stack.pop() as string
    if (seen.has(cur)) continue
    seen.add(cur)
    out.push(cur)
    for (const nb of adj[cur]) if (set.has(nb) && !seen.has(nb)) stack.push(nb)
  }
  for (const id of ids) if (!seen.has(id)) out.push(id)
  return out
}

// assemble grouped lines
const groupMembers: Record<string, string[]> = {}
const groupCodes: Record<string, string[]> = {}
for (const c of Object.keys(compMembers).map(Number)) {
  const g = lineOfComp[c]
  ;(groupMembers[g] ??= []).push(...compMembers[c])
  for (const cd of compCodes[c] ?? []) {
    ;(groupCodes[g] ??= [])
    if (!groupCodes[g].includes(cd)) groupCodes[g].push(cd)
  }
}
export const lineById: Record<string, SchemeLine> = {}
for (const g in groupMembers) {
  const ids = ordered(groupMembers[g])
  const ends = [...new Set(ids.filter((id) => adj[id].size <= 1).map((id) => nodeById[id].name).filter(Boolean))]
  const name = ends.length >= 2 ? `${ends[0]} – ${ends[ends.length - 1]}` : nodeById[ids[0]].name
  lineById[g] = {
    id: g,
    color: stationById[ids[0]].color,
    codes: groupCodes[g] ?? [],
    name,
    nodeIds: ids,
  }
}

/** Scheme line id for a tapped segment index (for line selection from the diagram). */
export const segmentLineId = (segIndex: number): string | null => {
  const n = segNode[segIndex]
  return n ? nodeById[n].lineId : null
}
