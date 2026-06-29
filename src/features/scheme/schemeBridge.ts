/**
 * Bridge from a relational scheme node to our simulated network, so the scheme can show LIVE
 * arrivals for the lines we actually simulate — resolved per (station-name + that node's own line),
 * never by name alone. Returns null when the node's line isn't simulated (then the card shows only
 * the relational info).
 */
import { network } from '@/data'
import { LINE_CODES } from './metroData'
import { lineById, nodeById, type SchemeNode } from './schemeModel'

const TR: Record<string, string> = {
  ş: 's', ı: 'i', İ: 'i', ç: 'c', ö: 'o', ü: 'u', ğ: 'g', â: 'a', î: 'i', û: 'u',
}
const norm = (s: string) =>
  s
    .replace(/[şıİçöüğâîû]/gi, (c) => TR[c.toLowerCase()] ?? c)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

// our line code -> canonical line id (prefer id === code; skip hidden sub-lines)
const CODE_TO_OURID: Record<string, string> = {}
for (const id in network.lines) {
  const l = network.lines[id]
  if (l.hidden || !l.code) continue
  if (!(l.code in CODE_TO_OURID) || id === l.code) CODE_TO_OURID[l.code] = id
}

// scheme colour -> our line ids (badged lines via code; Marmaray grey is un-badged)
const COLOR_TO_OURIDS: Record<string, string[]> = {}
for (const color in LINE_CODES) {
  COLOR_TO_OURIDS[color] = LINE_CODES[color].map((c) => CODE_TO_OURID[c]).filter(Boolean)
}
COLOR_TO_OURIDS['#585b60'] = ['B1', ...(network.lines['B2'] ? ['B2'] : [])]
// the pale line drawn without a code chip is the Metrobüs (34) corridor
if (network.lines['METROBUS']) COLOR_TO_OURIDS['#eede9e'] = ['METROBUS']

// (normalised name + '|' + our line id) -> our station id
const NAME_LINE_TO_ID: Record<string, string> = {}
for (const id in network.stations) {
  const s = network.stations[id]
  const n = s?.name?.tr
  if (!n) continue
  for (const lid of s.lines) NAME_LINE_TO_ID[`${norm(n)}|${lid}`] = id
}

export interface OurRef {
  stationId: string
  lineId: string
}

/** Resolve a scheme node to our (station, line) — for live data — or null if not simulated. */
export function resolveOur(node: SchemeNode): OurRef | null {
  const codes = lineById[node.lineId]?.codes ?? []
  const candidates = codes.map((c) => CODE_TO_OURID[c]).filter(Boolean)
  const lineIds = candidates.length ? candidates : COLOR_TO_OURIDS[node.color] ?? []
  const key = norm(node.name)
  for (const lid of lineIds) {
    const sid = NAME_LINE_TO_ID[`${key}|${lid}`]
    if (sid) return { stationId: sid, lineId: lid }
  }
  return null
}

// reverse: our (station, line) -> a scheme node, to draw a planned route back onto the diagram
const NODE_FOR_OUR: Record<string, string> = {}
const NODE_FOR_STATION: Record<string, string> = {}
for (const id in nodeById) {
  const ref = resolveOur(nodeById[id])
  if (!ref) continue
  if (!NODE_FOR_OUR[`${ref.stationId}|${ref.lineId}`]) NODE_FOR_OUR[`${ref.stationId}|${ref.lineId}`] = id
  if (!NODE_FOR_STATION[ref.stationId]) NODE_FOR_STATION[ref.stationId] = id
}

/** Scheme node for an our (station, line); falls back to any node of that station. */
export const schemeNodeForOur = (stationId: string, lineId: string): string | null =>
  NODE_FOR_OUR[`${stationId}|${lineId}`] ?? NODE_FOR_STATION[stationId] ?? null

