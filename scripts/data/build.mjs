/**
 * Build the static rail-network dataset from raw official sources.
 *
 *   node scripts/data/build.mjs   (run `fetch.mjs` first)
 *
 * Output: src/data/network.generated.json  (consumed by the app + simulation).
 *
 * Pipeline:
 *  1. Metro İstanbul API GetLines  → line metadata (code, official color, first/last).
 *  2. Metro İstanbul API GetStations → stations (Order, coords, accessibility, facilities).
 *  3. Cluster stations across lines → shared ids + transfer detection.
 *  4. İBB line GeoJSON, matched by code → merged ordered centerline per line.
 *  5. Snap stations to centerline, slice into segments (chord fallback per segment).
 *  6. Derive run-times, dwell, schedules, and per-line distance/time profiles.
 */
import fs from 'node:fs'
import path from 'node:path'
import * as turf from '@turf/turf'

const ROOT = path.resolve(import.meta.dirname, '../..')
const RAW = path.join(ROOT, 'data/raw')
const OUT = path.join(ROOT, 'src/data/network.generated.json')

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'))

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const DEG = Math.PI / 180
function havMeters(a, b) {
  const R = 6371008.8
  const dLat = (b[1] - a[1]) * DEG
  const dLng = (b[0] - a[0]) * DEG
  const la1 = a[1] * DEG
  const la2 = b[1] * DEG
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
const rgbToHex = (c) =>
  '#' +
  [c.Color_R, c.Color_G, c.Color_B]
    .map((v) => Math.max(0, Math.min(255, parseInt(v, 10) || 0)).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()

// Relative luminance → choose readable text color on a line color.
function onColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L > 0.5 ? '#101418' : '#FFFFFF'
}

const slug = (s) =>
  s
    .toLowerCase()
    .replaceAll('ı', 'i')
    .replaceAll('İ', 'i')
    .replaceAll('ğ', 'g')
    .replaceAll('ü', 'u')
    .replaceAll('ş', 's')
    .replaceAll('ö', 'o')
    .replaceAll('ç', 'c')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

function modeForCode(code) {
  if (/^TF/.test(code)) return 'cablecar'
  if (/^F/.test(code)) return 'funicular'
  if (/^T/.test(code)) return 'tram'
  return 'metro'
}

// ---------------------------------------------------------------------------
// geometry: stitch a MultiLineString's fragments into one ordered polyline
// ---------------------------------------------------------------------------
function collectFragments(features) {
  const frags = []
  for (const f of features) {
    const g = f.geometry
    if (!g) continue
    if (g.type === 'LineString') frags.push(g.coordinates)
    else if (g.type === 'MultiLineString') for (const part of g.coordinates) frags.push(part)
  }
  return frags.filter((p) => p && p.length >= 2)
}

function stitch(fragments, tolM = 70) {
  if (!fragments.length) return []
  const used = new Array(fragments.length).fill(false)

  // Prefer to start at a terminus (an endpoint that occurs only once).
  const key = (pt) => `${pt[0].toFixed(5)},${pt[1].toFixed(5)}`
  const count = new Map()
  for (const f of fragments) {
    for (const pt of [f[0], f[f.length - 1]]) count.set(key(pt), (count.get(key(pt)) || 0) + 1)
  }
  let startIdx = 0
  let startRev = false
  outer: for (let i = 0; i < fragments.length; i++) {
    const f = fragments[i]
    if (count.get(key(f[0])) === 1) {
      startIdx = i
      startRev = false
      break outer
    }
    if (count.get(key(f[f.length - 1])) === 1) {
      startIdx = i
      startRev = true
      break outer
    }
  }

  let line = startRev ? fragments[startIdx].slice().reverse() : fragments[startIdx].slice()
  used[startIdx] = true

  // Grow the tail; then reverse and grow the other end; then restore orientation.
  for (let pass = 0; pass < 2; pass++) {
    let extended = true
    while (extended) {
      extended = false
      const tail = line[line.length - 1]
      let best = -1
      let rev = false
      let bd = Infinity
      for (let i = 0; i < fragments.length; i++) {
        if (used[i]) continue
        const f = fragments[i]
        const ds = havMeters(tail, f[0])
        const de = havMeters(tail, f[f.length - 1])
        if (ds < bd) {
          bd = ds
          best = i
          rev = false
        }
        if (de < bd) {
          bd = de
          best = i
          rev = true
        }
      }
      if (best >= 0 && bd < tolM) {
        const f = rev ? fragments[best].slice().reverse() : fragments[best]
        used[best] = true
        line.push(...f.slice(1))
        extended = true
      }
    }
    line.reverse()
  }

  const coverage = used.filter(Boolean).length / fragments.length
  return { line, coverage }
}

// ---------------------------------------------------------------------------
// load raw
// ---------------------------------------------------------------------------
const linesRaw = readJson('getlines.json').Data
const stationsRaw = readJson('getstations.json').Data
const geo = readJson('lines.geojson')
const poi = readJson('stations_poi.geojson')

// name → candidate coords, to repair stations whose API coords are null
// (e.g. the freshly-opened M5 Sultanbeyli extension).
const poiByName = new Map()
for (const f of poi.features) {
  const s = slug(f.properties?.ISTASYON || '')
  if (!s || !f.geometry?.coordinates) continue
  if (!poiByName.has(s)) poiByName.set(s, [])
  poiByName.get(s).push(f.geometry.coordinates)
}
const coordOf = (s) => [parseFloat(s.DetailInfo?.Longitude), parseFloat(s.DetailInfo?.Latitude)]
const badCoord = (c) => !c || Number.isNaN(c[0]) || Number.isNaN(c[1])

// Group geojson features by line code (existing track only), matching the code token
// at the start of PROJE_AD_KISA. Multiple features per line are merged together.
function geometryForCode(code) {
  const re = new RegExp('^' + code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\b|\\s)')
  const feats = geo.features.filter(
    (f) =>
      f.properties?.PROJE_ASAMA === 'Mevcut' &&
      re.test((f.properties?.PROJE_AD_KISA || '').trim()),
  )
  if (!feats.length) return null
  const frags = collectFragments(feats)
  const { line, coverage } = stitch(frags)
  return line.length >= 2 ? { line, coverage, featureCount: feats.length } : null
}

// ---------------------------------------------------------------------------
// 1) lines
// ---------------------------------------------------------------------------
const lineById = new Map(linesRaw.map((l) => [l.Id, l]))
const lines = {}
for (const l of linesRaw) {
  const code = l.Name
  const color = rgbToHex(l.Color)
  lines[code] = {
    id: code,
    code,
    name: { tr: `${code} Hattı`, en: `${code} Line` }, // refined below from termini
    mode: modeForCode(code),
    status: 'operational',
    color,
    onColor: onColor(color),
    stations: [],
    firstTime: l.FirstTime,
    lastTime: l.LastTime,
    order: l.Order,
  }
}

// ---------------------------------------------------------------------------
// 2) stations grouped by line
// ---------------------------------------------------------------------------
const perLineStations = new Map() // code -> [{api station}], sorted by Order
for (const s of stationsRaw) {
  const line = lineById.get(s.LineId)
  if (!line) continue
  const code = line.Name
  if (!perLineStations.has(code)) perLineStations.set(code, [])
  perLineStations.get(code).push(s)
}
for (const arr of perLineStations.values()) arr.sort((a, b) => a.Order - b.Order)

// repair null API coords from the POI dataset (pick the same-name point nearest the
// previous good station, to disambiguate identically-named stations on other lines)
let repaired = 0
const dropped = []
for (const [code, arr] of perLineStations) {
  let lastGood = null
  for (const s of arr) {
    const c = coordOf(s)
    if (!badCoord(c)) {
      lastGood = c
      continue
    }
    const cands = poiByName.get(slug(s.Description)) || []
    let pick = null
    if (cands.length === 1) pick = cands[0]
    else if (cands.length > 1 && lastGood)
      pick = cands.slice().sort((a, b) => havMeters(a, lastGood) - havMeters(b, lastGood))[0]
    else if (cands.length > 1) pick = cands[0]
    if (pick) {
      s.DetailInfo = { ...(s.DetailInfo || {}), Longitude: String(pick[0]), Latitude: String(pick[1]) }
      lastGood = pick
      repaired++
    } else {
      dropped.push(`${code}:${s.Description}`)
    }
  }
  // drop any still-unrepairable stations so the geometry stays clean
  const filtered = arr.filter((s) => !badCoord(coordOf(s)))
  if (filtered.length !== arr.length) perLineStations.set(code, filtered)
}
if (repaired) console.log(`Repaired ${repaired} station coords from POI dataset.`)
if (dropped.length) console.log(`Dropped (no coord): ${dropped.join(', ')}`)

// ---------------------------------------------------------------------------
// 3) cluster physical stations across lines (transfer detection)
// ---------------------------------------------------------------------------
const CLUSTER_M = 160
const clusters = [] // { id, name, coords:[lng,lat], members:[apiStation], lines:Set }
function assignCluster(apiStation) {
  const lng = parseFloat(apiStation.DetailInfo.Longitude)
  const lat = parseFloat(apiStation.DetailInfo.Latitude)
  const pt = [lng, lat]
  let best = null
  let bd = Infinity
  for (const c of clusters) {
    const d = havMeters(pt, c.coords)
    if (d < bd) {
      bd = d
      best = c
    }
  }
  if (best && bd < CLUSTER_M) {
    best.members.push(apiStation)
    return best
  }
  const c = { id: null, name: apiStation.Description, coords: pt, members: [apiStation], lines: new Set() }
  clusters.push(c)
  return c
}

const stationOf = new Map() // apiStation.Id -> cluster
for (const s of stationsRaw) {
  const line = lineById.get(s.LineId)
  if (!line) continue
  if (badCoord(coordOf(s))) continue
  const c = assignCluster(s)
  c.lines.add(line.Name)
  stationOf.set(s.Id, c)
}

// finalize cluster ids (unique slugs)
const usedIds = new Set()
for (const c of clusters) {
  let base = slug(c.name) || 'st'
  let id = base
  let n = 2
  while (usedIds.has(id)) id = `${base}-${n++}`
  usedIds.add(id)
  c.id = id
}

// ---------------------------------------------------------------------------
// build station records
// ---------------------------------------------------------------------------
const stations = {}
for (const c of clusters) {
  // merge accessibility/facilities across members
  let escalator = 0
  let lift = 0
  let wc = false
  let babyRoom = false
  let masjid = false
  for (const m of c.members) {
    const d = m.DetailInfo || {}
    escalator += d.Escolator || 0
    lift += d.Lift || 0
    wc = wc || !!d.WC
    babyRoom = babyRoom || !!d.BabyRoom
    masjid = masjid || !!d.Masjid
  }
  const facilities = []
  if (wc) facilities.push('wc')
  // (parking/bike not in API; left for OSM enrichment later)
  stations[c.id] = {
    id: c.id,
    name: { tr: c.name, en: c.name },
    coord: [Number(c.coords[0].toFixed(6)), Number(c.coords[1].toFixed(6))],
    lines: [...c.lines].sort(),
    isTransfer: c.lines.size > 1,
    accessibility: {
      stepFree: lift > 0,
      elevator: lift > 0,
      escalator: escalator > 0,
    },
    facilities,
    extra: { escalatorCount: escalator, liftCount: lift, babyRoom, masjid },
  }
}

// ---------------------------------------------------------------------------
// 4+5) per-line station order + segment geometry
// ---------------------------------------------------------------------------
const SNAP_TOL_M = 280
const segments = {}
const buildReport = []

for (const code of Object.keys(lines)) {
  const apiStations = perLineStations.get(code) || []
  const orderedClusterIds = apiStations.map((s) => stationOf.get(s.Id).id)
  lines[code].stations = orderedClusterIds

  // termini-based names
  if (orderedClusterIds.length >= 2) {
    const a = stations[orderedClusterIds[0]].name.tr
    const b = stations[orderedClusterIds[orderedClusterIds.length - 1]].name.tr
    lines[code].name = { tr: `${a} – ${b}`, en: `${a} – ${b}` }
  }

  const geom = geometryForCode(code)
  let lineFeature = null
  let snapped = null
  if (geom) {
    lineFeature = turf.lineString(geom.line)
    snapped = apiStations.map((s) => {
      const pt = [parseFloat(s.DetailInfo.Longitude), parseFloat(s.DetailInfo.Latitude)]
      const np = turf.nearestPointOnLine(lineFeature, turf.point(pt), { units: 'kilometers' })
      return { loc: np.properties.location, distM: np.properties.dist * 1000 }
    })
  }

  const segs = []
  let chordCount = 0
  let sliceCount = 0
  for (let i = 0; i < orderedClusterIds.length - 1; i++) {
    const aId = orderedClusterIds[i]
    const bId = orderedClusterIds[i + 1]
    const aC = stations[aId].coord
    const bC = stations[bId].coord

    let geometry = null
    if (
      snapped &&
      snapped[i].distM < SNAP_TOL_M &&
      snapped[i + 1].distM < SNAP_TOL_M &&
      snapped[i + 1].loc > snapped[i].loc + 0.01
    ) {
      try {
        const sliced = turf.lineSlice(turf.point(aC), turf.point(bC), lineFeature)
        const simp = turf.simplify(turf.lineString(sliced.geometry.coordinates), {
          tolerance: 0.00004,
          highQuality: false,
        })
        const coords = simp.geometry.coordinates
        // sanity gate: a real curve between adjacent stations is at most ~1.7× the
        // straight chord. Anything longer means the stitched centerline is tangled
        // for this segment → reject and fall back to a clean chord.
        let len = 0
        for (let k = 1; k < coords.length; k++) len += havMeters(coords[k - 1], coords[k])
        const chord = havMeters(aC, bC)
        if (coords.length >= 2 && len <= chord * 1.7 && len >= chord * 0.85) {
          geometry = coords.map((p) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))])
          sliceCount++
        }
      } catch {
        /* fall through to chord */
      }
    }
    if (!geometry) {
      geometry = [aC, bC]
      chordCount++
    }

    let lengthM = 0
    for (let k = 1; k < geometry.length; k++) lengthM += havMeters(geometry[k - 1], geometry[k])

    segs.push({
      id: `${code}:${i}`,
      lineId: code,
      fromIndex: i,
      from: aId,
      to: bId,
      geometry,
      lengthM: Math.round(lengthM),
    })
  }
  segments[code] = segs
  buildReport.push({
    code,
    stations: orderedClusterIds.length,
    segs: segs.length,
    sliced: sliceCount,
    chord: chordCount,
    geomCoverage: geom ? +geom.coverage.toFixed(2) : 0,
    hasGeom: !!geom,
  })
}

// ---------------------------------------------------------------------------
// 6) run-times + schedules + profiles
// ---------------------------------------------------------------------------
const CRUISE = { metro: 12.5, tram: 6.5, funicular: 4.5, cablecar: 5.0, marmaray: 12.0 } // m/s
const ACCEL_PENALTY = 14 // s, accel+decel per segment
const MIN_RUN = 25 // s
const DWELL = { metro: 25, tram: 20, funicular: 40, cablecar: 30, marmaray: 75 }
const TERM_LAYOVER = { metro: 240, tram: 180, funicular: 120, cablecar: 90, marmaray: 300 }

// per-line peak headway overrides (seconds) from research; default by mode otherwise
const PEAK_HW = { M1A: 360, M1B: 240, M2: 235, M3: 360, M4: 300, M5: 300, M6: 300, M7: 240, M8: 360, M9: 360 }
const NIGHT_LINES = new Set(['M1A', 'M1B', 'M2', 'M4', 'M5', 'M6', 'M7'])

function headways(code, mode) {
  const peak = PEAK_HW[code] ?? (mode === 'metro' ? 300 : mode === 'tram' ? 360 : 240)
  const base = Math.round(peak * 1.5)
  const evening = Math.round(peak * 2.2)
  return { peak, base, evening }
}

const parseHM = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '')
  if (!m) return null
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

const schedules = {}
for (const code of Object.keys(lines)) {
  const L = lines[code]
  const mode = L.mode
  const { peak, base, evening } = headways(code, mode)

  // Operating window: use FirstTime if it's a normal morning value, else default 06:00.
  let first = parseHM(L.firstTime)
  if (first == null || first < 240) first = 360 // ignore weekend after-midnight values for the base window
  let last = parseHM(L.lastTime)
  if (last == null) last = 24 * 60
  if (last < 300) last += 24 * 60 // e.g. 00:02 → 1442

  const weekdayBands = [
    { startMin: first, endMin: 7 * 60, headwaySec: base },
    { startMin: 7 * 60, endMin: 10 * 60, headwaySec: peak },
    { startMin: 10 * 60, endMin: 16 * 60, headwaySec: base },
    { startMin: 16 * 60, endMin: 20 * 60, headwaySec: peak },
    { startMin: 20 * 60, endMin: last, headwaySec: evening },
  ].filter((b) => b.endMin > b.startMin)

  const weekendBands = [
    { startMin: first, endMin: 10 * 60, headwaySec: base },
    { startMin: 10 * 60, endMin: 20 * 60, headwaySec: Math.round((peak + base) / 2) },
    { startMin: 20 * 60, endMin: last, headwaySec: evening },
  ].filter((b) => b.endMin > b.startMin)

  const nightBand = NIGHT_LINES.has(code) ? [{ startMin: 0, endMin: 330, headwaySec: 1800 }] : []

  schedules[code] = {
    lineId: code,
    firstDepartureMin: first,
    lastDepartureMin: last,
    bands: {
      weekday: weekdayBands,
      saturday: [...nightBand, ...weekendBands],
      sunday: [...nightBand, ...weekendBands],
    },
    dwellSec: DWELL[mode],
    terminalLayoverSec: TERM_LAYOVER[mode],
    nightService: NIGHT_LINES.has(code),
  }
}

// run-times on segments + profiles
const profiles = {}
for (const code of Object.keys(lines)) {
  const mode = lines[code].mode
  const dwell = DWELL[mode]
  const cruise = CRUISE[mode] || 10
  const segs = segments[code]
  const cumDistanceM = [0]
  const cumTimeSec = [0]
  for (const seg of segs) {
    const run = Math.max(MIN_RUN, Math.round(seg.lengthM / cruise + ACCEL_PENALTY))
    seg.runTimeS = run
    cumDistanceM.push(cumDistanceM[cumDistanceM.length - 1] + seg.lengthM)
    cumTimeSec.push(cumTimeSec[cumTimeSec.length - 1] + run + dwell)
  }
  profiles[code] = {
    lineId: code,
    cumDistanceM,
    totalLengthM: cumDistanceM[cumDistanceM.length - 1],
    cumTimeSec,
    oneWayTimeSec: cumTimeSec[cumTimeSec.length - 1],
  }
}

// ---------------------------------------------------------------------------
// emit
// ---------------------------------------------------------------------------
const network = {
  meta: {
    version: '0.1.0',
    generatedAt: new Date().toISOString(),
    sources: [
      'Metro İstanbul Mobile API V2 (GetLines, GetStations)',
      'İBB Open Data — rayli_sistem_hat_verisi.geojson',
    ],
    note: 'v1 covers the 18 Metro İstanbul-operated lines. Marmaray + M11 added in a later pass.',
  },
  lines,
  stations,
  segments,
  schedules,
  profiles,
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(network))
const sizeKb = (fs.statSync(OUT).size / 1024).toFixed(0)

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
console.log('Build report (per line):')
console.table(
  buildReport.reduce((acc, r) => {
    acc[r.code] = {
      stations: r.stations,
      segs: r.segs,
      sliced: r.sliced,
      chord: r.chord,
      geom: r.hasGeom ? `${(r.geomCoverage * 100) | 0}%` : 'NONE',
    }
    return acc
  }, {}),
)
console.log(
  `\nStations (clustered): ${Object.keys(stations).length} | Lines: ${Object.keys(lines).length} | Transfers: ${Object.values(stations).filter((s) => s.isTransfer).length}`,
)
console.log(`Output: ${path.relative(ROOT, OUT)} (${sizeKb} KB)`)
