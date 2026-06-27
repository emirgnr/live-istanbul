/**
 * Lightweight place/address search (geocoding) so the journey planner can route
 * from/to arbitrary places ("X Okulu", a full address, …), not just stations.
 *
 * Uses Photon (https://photon.komoot.io) — free, key-less, CORS-enabled, OSM-based.
 * Results are biased toward Istanbul and filtered to the metropolitan bounds.
 */
export interface PlaceResult {
  label: string
  secondary: string
  coord: [number, number] // [lng, lat]
}

const BIAS = { lat: 41.01, lon: 28.97 }
const BOUNDS = { minLng: 27.6, minLat: 40.55, maxLng: 30.4, maxLat: 41.6 }

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const q = query.trim()
  if (q.length < 3) return []
  const url =
    `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}` +
    `&lat=${BIAS.lat}&lon=${BIAS.lon}&limit=8&lang=default`
  let data: { features?: GeoFeature[] }
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return []
    data = await res.json()
  } catch {
    return [] // offline / network / aborted → no suggestions
  }

  const out: PlaceResult[] = []
  const seen = new Set<string>()
  for (const f of data.features ?? []) {
    const c = f.geometry?.coordinates
    if (!c || c.length < 2) continue
    const coord: [number, number] = [c[0], c[1]]
    const p = f.properties ?? {}
    const label =
      p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || p.city || p.county || q
    const parts = [p.district || p.city || p.locality || p.county, p.state].filter(Boolean)
    const secondary = [...new Set(parts)].join(', ')
    const key = `${label}|${coord[0].toFixed(4)},${coord[1].toFixed(4)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ label, secondary, coord })
  }

  const inBounds = out.filter(
    (r) =>
      r.coord[0] >= BOUNDS.minLng &&
      r.coord[0] <= BOUNDS.maxLng &&
      r.coord[1] >= BOUNDS.minLat &&
      r.coord[1] <= BOUNDS.maxLat,
  )
  return (inBounds.length ? inBounds : out).slice(0, 6)
}

interface GeoFeature {
  geometry?: { coordinates?: number[] }
  properties?: {
    name?: string
    street?: string
    housenumber?: string
    district?: string
    city?: string
    locality?: string
    county?: string
    state?: string
  }
}
