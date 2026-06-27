import { network } from '@/data'
import { dayType, secondsSinceMidnight } from '@/lib/simulation/engine'
import type { LineId } from '@/lib/network/types'

/** Current service headway (seconds) for a line, or null when not operating now. */
export function currentHeadwaySec(lineId: LineId, nowMs: number): number | null {
  const sch = network.schedules[lineId]
  if (!sch) return null
  const d = new Date(nowMs)
  const bands = sch.bands[dayType(d)] ?? []
  const minute = secondsSinceMidnight(d) / 60
  const band = bands.find((b) => minute >= b.startMin && minute < b.endMin)
  return band ? band.headwaySec : null
}

export const isOperating = (lineId: LineId, nowMs: number): boolean =>
  currentHeadwaySec(lineId, nowMs) != null
