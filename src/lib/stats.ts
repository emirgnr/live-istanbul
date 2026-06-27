import { network, allStations } from '@/data'
import { dayType, secondsSinceMidnight } from '@/lib/simulation/engine'
import { haversineMeters } from '@/lib/geo'
import type { LineId, Station } from '@/lib/network/types'

/** Nearest station to a [lng, lat] point. */
export function nearestStation(lng: number, lat: number): { station: Station; distM: number } | null {
  let best: Station | null = null
  let bd = Infinity
  for (const s of allStations()) {
    const d = haversineMeters([lng, lat], s.coord)
    if (d < bd) {
      bd = d
      best = s
    }
  }
  return best ? { station: best, distM: bd } : null
}

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

/** Min/max scheduled headway (seconds) across a day type's bands, or null. */
export function headwayRange(
  lineId: LineId,
  dt: ReturnType<typeof dayType> = 'weekday',
): { minSec: number; maxSec: number } | null {
  const bands = network.schedules[lineId]?.bands?.[dt] ?? []
  if (!bands.length) return null
  let minSec = Infinity
  let maxSec = -Infinity
  for (const b of bands) {
    if (b.headwaySec < minSec) minSec = b.headwaySec
    if (b.headwaySec > maxSec) maxSec = b.headwaySec
  }
  return { minSec, maxSec }
}
