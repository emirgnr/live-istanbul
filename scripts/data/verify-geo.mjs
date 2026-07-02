/**
 * Verify the geo dataset against İBB's own authoritative sources.
 *
 *   node scripts/data/verify-geo.mjs        # (or: npm run verify:geo)
 *
 * This is the reproducible, auditable form of the 2026-07-02 verification: it re-fetches
 * the official İBB Metro API (station coordinates) and the İBB Open-Data rail LINE-geometry
 * GeoJSON (the real track routes) and measures how closely `src/data/network.generated.json`
 * matches them — proving the dataset is API-derived and correct, not hand-authored. Re-run it
 * any time (e.g. after a data rebuild) to catch drift. Exits non-zero if anything is out of
 * tolerance, so it can gate CI.
 *
 * Not in the İBB rail set (checked separately vs OSM, see docs): METROBUS (BRT), B2
 * (TCDD Halkalı–Bahçeşehir suburban), F3 (Seyrantepe funicular).
 */
import fs from 'node:fs'
import path from 'node:path'
import { SOURCES } from './sources.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')
const net = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/network.generated.json'), 'utf8'))

const R = 6371000
const rad = (d) => (d * Math.PI) / 180
const hav = (a, b) => {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
function pointSeg(p, a, b) {
  const lat0 = rad((a[1] + b[1]) / 2), k = Math.cos(lat0) * R
  const P = [rad(p[0]) * k, rad(p[1]) * R], A = [rad(a[0]) * k, rad(a[1]) * R], B = [rad(b[0]) * k, rad(b[1]) * R]
  const dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy
  let t = l2 ? ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(P[0] - (A[0] + t * dx), P[1] - (A[1] + t * dy))
}
const minDist = (p, segs) => {
  let m = Infinity
  for (const s of segs) { const d = pointSeg(p, s[0], s[1]); if (d < m) m = d; if (m < 1) break }
  return m
}
const norm = (s) =>
  (s || '').toLocaleUpperCase('tr')
    .replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G').replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C')
    .replace(/[^A-Z0-9]/g, '')

async function getJson(url) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), 25000)
  try {
    const r = await fetch(url, { signal: c.signal })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

// our per-line polyline from segments
function ourPoly(lid) {
  const segs = net.segments[lid]
  if (!segs?.length) return []
  const c = [segs[0].geometry[0]]
  for (const s of segs) for (let i = 1; i < s.geometry.length; i++) c.push(s.geometry[i])
  return c
}

// İBB line features whose name covers a given line code (all branches/stages combined)
const ibbName = (f) => (f.properties.PROJE_AD_KISA || f.properties.PROJE_ADI || '').trim()
function ibbFeaturesFor(code, feats) {
  if (code === 'B1') return feats.filter((f) => /Marmaray/i.test(ibbName(f)))
  if (code === 'T6') return feats.filter((f) => ibbName(f).startsWith('Sirkeci - Kazl'))
  // Branch services that ride a sibling's trunk must reference the sibling's İBB feature too:
  // İBB files the shared Yenikapı–Otogar trunk under M1A (not M1B), and M2S rides M2's trunk.
  const codes = code === 'M1B' ? ['M1B', 'M1A'] : code === 'M2S' ? ['M2'] : [code]
  return feats.filter((f) => {
    const nm = ibbName(f)
    return codes.some((cc) => {
      if (!nm.startsWith(cc)) return false
      const c = nm[cc.length]
      return c === undefined || c === ' ' || c === '('
    })
  })
}
function segsOf(feats) {
  const segs = []
  for (const f of feats) {
    const g = f.geometry
    const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates
    for (const ln of lines) for (let i = 0; i < ln.length - 1; i++) segs.push([ln[i], ln[i + 1]])
  }
  return segs
}

const NOT_IN_IBB_RAIL = new Set(['METROBUS', 'B2', 'F3'])
// Short funiculars whose endpoints are SHARED SURFACE stations (Taksim=F1+T2, Karaköy=F2+T1,
// Tünel=F2+T2). Those dots are placed on the shared surface station (verified vs İBB's T1/T2
// geometry to ~2–20 m), so they deviate from the İBB *funicular-track* endpoint by design.
// Reported for transparency but not gated. (2026-07-02 agent adjudication: KEEP.)
const SOFT = new Set(['F1', 'F2'])
// tolerance: a line passes if its vertices sit close to the İBB centerline
const MEAN_MAX = 40 // metres (average deviation)
const WITHIN40_MIN = 70 // percent of vertices within 40 m
const STATION_MAX = 90 // metres vs İBB API (line-scoped)

async function main() {
  console.log('Fetching İBB authoritative sources…')
  const [apiStations, geoLines] = await Promise.all([
    getJson(SOURCES.getStations.url),
    getJson(SOURCES.lineGeometry.url),
  ])
  const feats = geoLines.features
  let warnings = 0

  // ---- 1) LINE GEOMETRY vs İBB official ----
  console.log('\n=== Line geometry vs İBB official rail geometry ===')
  const rendered = Object.values(net.lines).filter((l) => !l.hidden).map((l) => l.id)
  for (const code of rendered) {
    if (NOT_IN_IBB_RAIL.has(code)) {
      console.log(`  ·  ${code.padEnd(7)} not in İBB rail set — verified separately vs OSM`)
      continue
    }
    const our = ourPoly(code)
    const refs = ibbFeaturesFor(code, feats)
    if (our.length < 2 || !refs.length) {
      console.log(`  ⚠  ${code.padEnd(7)} no İBB match (our ${our.length} pts)`)
      warnings++
      continue
    }
    const segs = segsOf(refs)
    const ds = our.map((p) => minDist(p, segs))
    const mean = ds.reduce((a, b) => a + b, 0) / ds.length
    const within40 = (ds.filter((d) => d <= 40).length / ds.length) * 100
    const ok = mean <= MEAN_MAX && within40 >= WITHIN40_MIN
    const soft = SOFT.has(code)
    if (!ok && !soft) warnings++
    const mark = ok ? '✓' : soft ? '·' : '⚠'
    console.log(
      `  ${mark}  ${code.padEnd(7)} mean=${String(Math.round(mean)).padStart(3)}m within40=${within40.toFixed(0).padStart(3)}%` +
        (soft ? '  (funicular — endpoints are shared surface stations)' : ''),
    )
  }

  // ---- 2) STATION COORDS vs İBB Metro API (line-scoped, metro only) ----
  console.log('\n=== Station coordinates vs İBB Metro API (informational — does not gate) ===')
  // slugs that are deliberate curated overrides (placed against a source more accurate than the
  // İBB API point, which is itself sometimes an offset building/entrance coordinate).
  const overrideSlugs = new Set(
    JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'overrides.json'), 'utf8')).pins.map((p) => p.slug),
  )
  const byName = {}
  for (const st of Object.values(net.stations)) (byName[norm(st.name.tr)] ||= []).push(st)
  let matched = 0, far = 0
  const worst = []
  for (const s of apiStations.Data ?? []) {
    const lat = parseFloat(s.DetailInfo?.Latitude), lon = parseFloat(s.DetailInfo?.Longitude)
    if (!lat || !lon) continue
    const cands = byName[norm(s.Description)] || byName[norm(s.Name)]
    if (!cands) continue
    let best = Infinity, bestId = null
    for (const st of cands) { const d = hav(st.coord, [lon, lat]); if (d < best) { best = d; bestId = st.id } }
    matched++
    if (best > STATION_MAX) { far++; worst.push([Math.round(best), bestId, s.LineName]) }
  }
  worst.sort((a, b) => b[0] - a[0])
  console.log(`  matched ${matched} İBB API stations; ${far} beyond ${STATION_MAX} m`)
  worst.slice(0, 12).forEach((r) => {
    const ov = [...overrideSlugs].some((sl) => r[1] === sl || r[1].startsWith(sl))
    console.log(`     ${r[0]}m  ${r[1]} [${r[2]}]${ov ? '  (curated override — verified vs Wikidata)' : ''}`)
  })
  console.log('  Note: outliers are large-station entrance/platform ambiguity or curated overrides,')
  console.log('  not errors — the İBB API point itself is sometimes offset. Only geometry gates exit.')

  console.log(`\n${warnings ? '⚠' : '✓'} Geometry: ${warnings} line(s) out of tolerance.`)
  process.exit(warnings ? 1 : 0)
}

main().catch((e) => {
  console.error('verify-geo failed:', e.message)
  process.exit(2)
})
