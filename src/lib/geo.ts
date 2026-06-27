import type { LngLat } from '@/lib/network/types'

const R = 6_371_008.8 // mean Earth radius, meters (IUGG)
const DEG = Math.PI / 180

/** Great-circle distance between two [lng, lat] points, in meters. */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const lat1 = a[1] * DEG
  const lat2 = b[1] * DEG
  const dLat = (b[1] - a[1]) * DEG
  const dLng = (b[0] - a[0]) * DEG
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Initial bearing from a → b, in degrees (0 = north, clockwise). */
export function bearingBetween(a: LngLat, b: LngLat): number {
  const lat1 = a[1] * DEG
  const lat2 = b[1] * DEG
  const dLng = (b[0] - a[0]) * DEG
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (Math.atan2(y, x) / DEG + 360) % 360
}

/** Total length of a polyline in meters. */
export function lineLengthMeters(coords: LngLat[]): number {
  let total = 0
  for (let i = 1; i < coords.length; i++) total += haversineMeters(coords[i - 1], coords[i])
  return total
}

/** Cumulative distance (meters) at each vertex of a polyline; length === coords.length. */
export function cumulativeDistances(coords: LngLat[]): number[] {
  const out = new Array<number>(coords.length)
  out[0] = 0
  for (let i = 1; i < coords.length; i++) {
    out[i] = out[i - 1] + haversineMeters(coords[i - 1], coords[i])
  }
  return out
}

/** Linear interpolation between two points (good enough for short transit segments). */
export function lerpCoord(a: LngLat, b: LngLat, t: number): LngLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

export interface PointOnLine {
  coord: LngLat
  bearing: number
}

/**
 * Position a point a given distance (meters) along a polyline, with the local heading.
 * Clamps to the polyline endpoints. Pass a precomputed `cum` for hot paths.
 */
export function pointAtDistance(
  coords: LngLat[],
  distanceM: number,
  cum?: number[],
): PointOnLine {
  if (coords.length === 1) return { coord: coords[0], bearing: 0 }
  const cumDist = cum ?? cumulativeDistances(coords)
  const total = cumDist[cumDist.length - 1]
  const d = Math.max(0, Math.min(distanceM, total))

  // Binary search for the segment containing distance d.
  let lo = 0
  let hi = cumDist.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cumDist[mid] < d) lo = mid + 1
    else hi = mid
  }
  const i = Math.max(1, lo)
  const segStart = cumDist[i - 1]
  const segLen = cumDist[i] - segStart || 1
  const t = (d - segStart) / segLen
  return {
    coord: lerpCoord(coords[i - 1], coords[i], t),
    bearing: bearingBetween(coords[i - 1], coords[i]),
  }
}
