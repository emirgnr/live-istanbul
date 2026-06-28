/**
 * Build the static rail-network dataset.
 *
 *   node scripts/data/fetch.mjs       # Metro İstanbul API + İBB GeoJSON
 *   node scripts/data/fetch-osm.mjs   # OpenStreetMap route relations
 *   node scripts/data/build.mjs       # → src/data/network.generated.json
 *
 * Geometry + station ORDER come from OpenStreetMap route relations (clean, ordered),
 * which fixes zig-zags, off-line stations and wrong sequences. Colors, service times
 * and accessibility come from the official Metro İstanbul API where available. Lines
 * absent from the API (M11, Marmaray, B2, T2, T6, F2, F3, Metrobüs) are sourced fully
 * from OSM. Under-construction lines are overlaid from İBB GeoJSON.
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
function hav(a, b) {
  const R = 6371008.8
  const dLat = (b[1] - a[1]) * DEG
  const dLng = (b[0] - a[0]) * DEG
  const la1 = a[1] * DEG
  const la2 = b[1] * DEG
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
const rgbToHex = (c) =>
  '#' +
  [c.Color_R, c.Color_G, c.Color_B]
    .map((v) => Math.max(0, Math.min(255, parseInt(v, 10) || 0)).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
function onColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L > 0.5 ? '#101418' : '#FFFFFF'
}
const slug = (s) =>
  (s || '')
    .toLocaleLowerCase('tr')
    .replaceAll('ı', 'i').replaceAll('İ', 'i').replaceAll('ğ', 'g')
    .replaceAll('ü', 'u').replaceAll('ş', 's').replaceAll('ö', 'o').replaceAll('ç', 'c')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// ---------------------------------------------------------------------------
// load sources
// ---------------------------------------------------------------------------
const osm = readJson('osm.json')
const linesApi = readJson('getlines.json').Data
const stationsApi = readJson('getstations.json').Data
const geo = readJson('lines.geojson')

const apiByCode = new Map(linesApi.map((l) => [l.Name, l]))

// API stations grouped by line code (ordered), with accessibility detail
const apiStationsByCode = new Map()
for (const s of stationsApi) {
  const line = linesApi.find((l) => l.Id === s.LineId)
  if (!line) continue
  const lng = parseFloat(s.DetailInfo?.Longitude)
  const lat = parseFloat(s.DetailInfo?.Latitude)
  if (Number.isNaN(lng) || Number.isNaN(lat)) continue
  if (!apiStationsByCode.has(line.Name)) apiStationsByCode.set(line.Name, [])
  apiStationsByCode.get(line.Name).push({
    name: s.Description,
    coord: [lng, lat],
    order: s.Order,
    detail: s.DetailInfo,
  })
}
for (const arr of apiStationsByCode.values()) arr.sort((a, b) => a.order - b.order)

// accessibility by station name (slug) for OSM-sourced lines
const detailByName = new Map()
for (const s of stationsApi) {
  const k = slug(s.Description)
  if (!k || detailByName.has(k)) continue
  detailByName.set(k, s.DetailInfo)
}

// ---------------------------------------------------------------------------
// OSM parsing
// ---------------------------------------------------------------------------
const nodeMap = new Map()
for (const e of osm.elements) if (e.type === 'node') nodeMap.set(e.id, e)
const relations = osm.elements.filter((e) => e.type === 'relation')

function osmStops(rel) {
  const out = []
  const seen = new Set()
  for (const m of rel.members) {
    if (m.type !== 'node' || !/^stop/.test(m.role || '')) continue
    const n = nodeMap.get(m.ref)
    const name = n?.tags?.name
    if (!name) continue
    const k = slug(name)
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ name, coord: [n.lon, n.lat] })
  }
  return out
}

// Stitch a route relation's member ways into a single ordered centerline. OSM ways
// can be unordered/reversed; naive concat tangles them. Clean rail relations form one
// chain; fragmented relations (e.g. the Metrobüs bus route, 188 ways with gaps) need
// multiple chains bridged together. So: (1) greedily build maximal chains with a tight
// within-chain gap (120 m), then (2) join the substantial chains end-to-end across
// larger gaps, dropping tiny spurs so clean lines are unaffected.
function lenOf(c) {
  let l = 0
  for (let k = 1; k < c.length; k++) l += hav(c[k - 1], c[k])
  return l
}
function osmCenterline(rel) {
  const ways = rel.members
    .filter((m) => m.type === 'way' && m.geometry && m.geometry.length >= 2)
    .map((m) => m.geometry.map((p) => [p.lon, p.lat]))
  if (!ways.length) return null

  // 1) maximal chains (tight within-chain tolerance)
  const used = new Array(ways.length).fill(false)
  const chains = []
  for (;;) {
    const s = used.findIndex((u) => !u)
    if (s < 0) break
    let line = ways[s].slice()
    used[s] = true
    for (let pass = 0; pass < 2; pass++) {
      let ext = true
      while (ext) {
        ext = false
        const tail = line[line.length - 1]
        let best = -1
        let rev = false
        let bd = Infinity
        for (let i = 0; i < ways.length; i++) {
          if (used[i]) continue
          const w = ways[i]
          const ds = hav(tail, w[0])
          const de = hav(tail, w[w.length - 1])
          if (ds < bd) { bd = ds; best = i; rev = false }
          if (de < bd) { bd = de; best = i; rev = true }
        }
        if (best >= 0 && bd < 120) {
          const w = rev ? ways[best].slice().reverse() : ways[best]
          used[best] = true
          line.push(...w.slice(1))
          ext = true
        }
      }
      line.reverse()
    }
    chains.push(line)
  }

  // 2) join substantial chains by nearest endpoint (bridge gaps up to 700 m)
  let frags = chains.filter((c) => lenOf(c) >= 600)
  if (!frags.length) frags = chains
  frags.sort((a, b) => lenOf(b) - lenOf(a))
  let line = frags.shift().slice()
  let progress = true
  while (frags.length && progress) {
    progress = false
    const head = line[0]
    const tail = line[line.length - 1]
    let best = -1
    let rev = false
    let atTail = true
    let bd = Infinity
    for (let i = 0; i < frags.length; i++) {
      const c = frags[i]
      const tt0 = hav(tail, c[0])
      const tt1 = hav(tail, c[c.length - 1])
      const hh0 = hav(head, c[0])
      const hh1 = hav(head, c[c.length - 1])
      if (tt0 < bd) { bd = tt0; best = i; rev = false; atTail = true }
      if (tt1 < bd) { bd = tt1; best = i; rev = true; atTail = true }
      if (hh1 < bd) { bd = hh1; best = i; rev = false; atTail = false }
      if (hh0 < bd) { bd = hh0; best = i; rev = true; atTail = false }
    }
    if (best >= 0 && bd < 700) {
      let c = frags.splice(best, 1)[0]
      if (rev) c = c.slice().reverse()
      if (atTail) line.push(...c)
      else line.unshift(...c)
      progress = true
    }
  }
  return line
}

function pickRelation(ref, hint) {
  const cands = relations.filter((r) => (r.tags?.ref || '') === ref && osmStops(r).length > 0)
  if (!cands.length) return null
  if (hint) {
    const h = cands.find((r) => (r.tags?.name || '').includes(hint))
    if (h) return h
  }
  return cands.sort((a, b) => osmStops(b).length - osmStops(a).length)[0]
}
function pickByName(re) {
  return relations
    .filter((r) => re.test(r.tags?.name || '') && osmStops(r).length > 0)
    .sort((a, b) => osmStops(b).length - osmStops(a).length)[0]
}

// ---------------------------------------------------------------------------
// line configuration
// ---------------------------------------------------------------------------
const cfgs = [
  // API lines: stops + color/schedule from API, geometry from OSM by ref
  { code: 'M1A', mode: 'metro', src: 'api', osmRef: 'M1A', hint: 'Yenikapı - Havalimanı' },
  { code: 'M1B', mode: 'metro', src: 'api', osmRef: 'M1B', hint: 'Yenikapı - Kirazlı' },
  // M2 main through-route only (Yenikapı–Hacıosman); Seyrantepe is a real fork off Sanayi
  // Mahallesi → modeled as the M2S route-pattern sibling in §5b (no false in-line detour).
  { code: 'M2', mode: 'metro', src: 'api', osmRef: 'M2', hint: 'Yenikapı - Hacıosman', dropStations: ['seyrantepe'], name: 'Yenikapı – Hacıosman' },
  { code: 'M3', mode: 'metro', src: 'api', osmRef: 'M3', hint: 'Bakırköy Sahil' },
  { code: 'M4', mode: 'metro', src: 'api', osmRef: 'M4', hint: 'Kadıköy' },
  // M5 sourced from OSM (24-station Üsküdar→Sultanbeyli; the Metro API station feed is
  // stale at 21 stops, pre-Sultanbeyli extension). Color/hours preserved from the API.
  { code: 'M5', mode: 'metro', src: 'osm', osmRef: 'M5', hint: 'Üsküdar → Sultanbeyli', color: '#683064', first: '06:00', last: '00:00', night: true, name: 'Üsküdar – Sultanbeyli' },
  { code: 'M6', mode: 'metro', src: 'api', osmRef: 'M6', hint: 'Levent' },
  { code: 'M7', mode: 'metro', src: 'api', osmRef: 'M7', hint: 'Mahmutbey - Mecidiyeköy' },
  { code: 'M8', mode: 'metro', src: 'api', osmRef: 'M8', hint: 'Bostancı - Parseller' },
  { code: 'M9', mode: 'metro', src: 'api', osmRef: 'M9', hint: 'Ataköy', color: '#FFD300' },
  { code: 'T1', mode: 'tram', src: 'api', osmRef: 'T1', hint: 'Kabataş - Bağcılar', peak: 120 }, // official 2 dk pik
  { code: 'T3', mode: 'tram', src: 'api', osmRef: 'T3', peak: 600 }, // official 10 dk pik
  { code: 'T4', mode: 'tram', src: 'api', osmRef: 'T4', hint: 'Topkapı', peak: 180 }, // official 3 dk pik
  { code: 'T5', mode: 'tram', src: 'api', osmRef: 'T5', hint: 'Eminönü', peak: 300 }, // official 5 dk pik
  { code: 'F1', mode: 'funicular', src: 'api', osmRef: 'F1', peak: 180 }, // official 3 dk pik
  { code: 'F4', mode: 'funicular', src: 'api', osmRef: 'F4' },
  { code: 'TF1', mode: 'cablecar', src: 'api', peak: 300 }, // official 5 dk pik
  { code: 'TF2', mode: 'cablecar', src: 'api', peak: 300 }, // official 5 dk pik
  // OSM-sourced lines (not in the Metro API)
  { code: 'M11', mode: 'metro', src: 'osm', osmRef: 'M11', hint: 'Gayrettepe → Halkalı', color: '#9B4E9C', first: '06:00', last: '00:40', peak: 360, night: true, name: 'Gayrettepe – İstanbul Havalimanı – Halkalı' },
  // Marmaray: 15-min full-line peak (official); last Gebze departure 23:20 weekday. NOT a 24h
  // line — its limited weekend-night extension is built in §5c, so it is left out of NIGHT_HW.
  { code: 'B1', mode: 'marmaray', src: 'osm', osmRef: 'B1', hint: 'Halkalı - Gebze', color: '#009A93', first: '06:00', last: '23:20', peak: 900, name: 'Marmaray · Halkalı – Gebze', renames: { Gülhane: 'Sirkeci' } },
  { code: 'B2', mode: 'suburban', src: 'osm', osmRef: 'B2', hint: 'Halkalı - Bahçeşehir', color: '#77787C', first: '06:00', last: '23:00', peak: 1200, name: 'Halkalı – Bahçeşehir Banliyö' },
  { code: 'T2', mode: 'tram', src: 'osm', osmName: /Taksim - Tünel Nostaljik/, color: '#B12A2A', first: '07:00', last: '22:00', peak: 600, name: 'Taksim – Tünel Nostaljik Tramvay' },
  { code: 'T6', mode: 'tram', src: 'osm', osmRef: 'T6', hint: 'Sirkeci', color: '#E87D7D', first: '06:00', last: '23:05', peak: 1500, name: 'Sirkeci – Kazlıçeşme' }, // banliyö: official 25 dk sabit, son tren 23:05
  { code: 'F2', mode: 'funicular', src: 'poi', color: '#7A745A', first: '07:00', last: '22:45', peak: 300, name: 'Karaköy – Beyoğlu (Tünel)' },
  { code: 'F3', mode: 'funicular', src: 'osm', osmRef: 'F3', color: '#7A745A', first: '06:00', last: '00:00', peak: 300, name: 'Seyrantepe – Vadistanbul' },
  { code: 'METROBUS', mode: 'brt', src: 'osm', osmRef: '34G', hint: 'Beylikdüzü → Söğütlüçeşme', badge: 'MB', color: '#DED59A', first: '00:00', last: '23:59', peak: 90, name: 'Metrobüs · Beylikdüzü – Söğütlüçeşme', cleanSpurs: true },
]

// ---------------------------------------------------------------------------
// 1) resolve per-line ordered stations + centerline
// ---------------------------------------------------------------------------
const lineData = [] // { cfg, color, stations:[{name,coord,detail}], centerline }
let orderIdx = 0
for (const cfg of cfgs) {
  let stations = []
  let centerline = null

  if (cfg.src === 'api') {
    stations = apiStationsByCode.get(cfg.code) || []
  } else if (cfg.src === 'osm') {
    const rel = cfg.osmName ? pickByName(cfg.osmName) : pickRelation(cfg.osmRef, cfg.hint)
    if (rel) {
      stations = osmStops(rel).map((s) => {
        const name = cfg.renames?.[s.name] || s.name
        return { name, coord: s.coord, detail: detailByName.get(slug(name)) }
      })
      centerline = osmCenterline(rel)
    }
  } else if (cfg.src === 'poi') {
    // F2 Tünel: two stations from POI
    const poi = readJson('stations_poi.geojson')
    const feats = poi.features.filter((f) => (f.properties?.PROJE_ADI || '').startsWith('F2'))
    stations = feats.map((f) => ({ name: f.properties.ISTASYON, coord: f.geometry.coordinates }))
  }

  if (cfg.src === 'api' && (cfg.osmRef || cfg.osmName)) {
    const rel = cfg.osmName ? pickByName(cfg.osmName) : pickRelation(cfg.osmRef, cfg.hint)
    if (rel) centerline = osmCenterline(rel)
  }

  // remove stations that are not on this line's MAIN through-route (e.g. the M2 Seyrantepe
  // branch stop, which is modeled separately as a route-pattern sibling — see §5b)
  if (cfg.dropStations?.length) {
    const drop = new Set(cfg.dropStations)
    stations = stations.filter((s) => !drop.has(slug(s.name)))
  }

  if (stations.length < 2) {
    console.log(`! ${cfg.code}: only ${stations.length} stations — skipped`)
    continue
  }

  const api = apiByCode.get(cfg.code)
  const color = cfg.color || (api ? rgbToHex(api.Color) : '#888888')
  lineData.push({
    cfg,
    color,
    order: orderIdx++,
    first: cfg.first || api?.FirstTime || '06:00',
    last: cfg.last || api?.LastTime || '00:00',
    stations,
    centerline,
  })
}

// ---------------------------------------------------------------------------
// 2) cluster stations across lines (transfer detection)
// ---------------------------------------------------------------------------
const CLUSTER_M = 210 // same physical station merges within this; farther → walking transfer (linked circles)
const clusters = []
// The Metrobüs (BRT) busway runs in the road median, physically separate from every rail
// platform it passes — so a Metrobüs stop is NEVER merged into a rail station's dot. It
// stays its own dot ON the busway and is linked to the nearby rail station as a walking
// interchange (linked circles). Merging pulled the dot onto the rail track, which spiked
// the busway line and made simulated buses dart off-route and snap back at the stop.
const clusterKey = (name, lineCode) => {
  const sn = slug(name)
  return lineCode === 'METROBUS' ? `${sn}#METROBUS` : sn
}
// Merge only stations with the SAME cluster key that are genuinely co-located (one
// physical station, e.g. Yenikapı/Sirkeci across lines). Differently-named or walk-apart
// interchanges stay separate and are linked later as walking transfers (linked circles).
function assign(name, coord, lineCode) {
  const ck = clusterKey(name, lineCode)
  let best = null
  let bd = Infinity
  for (const c of clusters) {
    if (c.key !== ck) continue
    const d = hav(coord, c.coord)
    if (d < bd) {
      bd = d
      best = c
    }
  }
  if (best && bd < CLUSTER_M) return best
  const c = { id: null, key: ck, name, coord, members: [], lines: new Set() }
  clusters.push(c)
  return c
}

for (const ld of lineData) {
  ld.clusterIds = []
  for (const st of ld.stations) {
    const c = assign(st.name, st.coord, ld.cfg.code)
    c.members.push(st)
    c.lines.add(ld.cfg.code)
    ld.clusterIds.push(c)
  }
}
// finalize ids + coords (average members)
const usedIds = new Set()
for (const c of clusters) {
  let avgLng = 0
  let avgLat = 0
  for (const m of c.members) {
    avgLng += m.coord[0]
    avgLat += m.coord[1]
  }
  c.coord = [avgLng / c.members.length, avgLat / c.members.length]
  let base = slug(c.name) || 'st'
  let id = base
  let n = 2
  while (usedIds.has(id)) id = `${base}-${n++}`
  usedIds.add(id)
  c.id = id
}

// ---------------------------------------------------------------------------
// 3) station records
// ---------------------------------------------------------------------------
const stations = {}
for (const c of clusters) {
  let escalator = 0
  let lift = 0
  let wc = false
  let babyRoom = false
  let masjid = false
  for (const m of c.members) {
    const d = m.detail
    if (!d) continue
    escalator += d.Escolator || 0
    lift += d.Lift || 0
    wc = wc || !!d.WC
    babyRoom = babyRoom || !!d.BabyRoom
    masjid = masjid || !!d.Masjid
  }
  stations[c.id] = {
    id: c.id,
    name: { tr: c.name, en: c.name },
    coord: [Number(c.coord[0].toFixed(6)), Number(c.coord[1].toFixed(6))],
    lines: [...c.lines].sort(),
    isTransfer: c.lines.size > 1,
    accessibility: { stepFree: lift > 0, elevator: lift > 0, escalator: escalator > 0 },
    facilities: wc ? ['wc'] : [],
    extra: { escalatorCount: escalator, liftCount: lift, babyRoom, masjid },
  }
}

// ---------------------------------------------------------------------------
// 4) lines + segments (snap stations to OSM centerline, slice; chord fallback)
// ---------------------------------------------------------------------------
const SNAP_TOL_M = 320
const lines = {}
const segments = {}
const report = []

// pass 1: line records + snap each station to its line centerline (track its
// nearest centerline across all its lines)
const bestSnap = {} // stationId -> { distM, coord }
for (const ld of lineData) {
  const code = ld.cfg.code
  const ids = ld.clusterIds.map((c) => c.id)
  ld.ids = ids
  const a = stations[ids[0]].name.tr
  const b = stations[ids[ids.length - 1]].name.tr
  lines[code] = {
    id: code,
    code: ld.cfg.badge || code,
    name: ld.cfg.name ? { tr: ld.cfg.name, en: ld.cfg.name } : { tr: `${a} – ${b}`, en: `${a} – ${b}` },
    mode: ld.cfg.mode,
    status: 'operational',
    color: ld.color,
    onColor: onColor(ld.color),
    stations: ids,
    firstTime: ld.first,
    lastTime: ld.last,
    order: ld.order,
  }
  if (ld.centerline && ld.centerline.length >= 2) {
    ld.lineFeature = turf.lineString(ld.centerline)
    // snap each line's ORIGINAL stop coord (always on that line's track), not the
    // merged cluster coord — so transfers don't corrupt a line's geometry
    ld.snapped = ld.stations.map((st, i) => {
      const np = turf.nearestPointOnLine(ld.lineFeature, turf.point(st.coord), { units: 'kilometers' })
      const coord = np.geometry.coordinates
      const distM = np.properties.dist * 1000
      const id = ids[i]
      if (!bestSnap[id] || distM < bestSnap[id].distM) bestSnap[id] = { distM, coord }
      return { loc: np.properties.location, distM, coord }
    })
  } else {
    ld.snapped = null
  }
}

// move each station dot exactly onto its nearest track so the line passes
// straight through it (no stub); transfers then meet at the shared dot
for (const [id, bs] of Object.entries(bestSnap)) {
  if (bs.distM < SNAP_TOL_M) stations[id].coord = [Number(bs.coord[0].toFixed(6)), Number(bs.coord[1].toFixed(6))]
}

// explicit coordinate pins for stations where the operator's official position
// differs from OSM (verified hub locations). Matched by name + line membership so
// they survive id/clustering changes. Applied after snapping; segment endpoints are
// pinned to these dots (below), and walking transfers recomputed from them.
const COORD_PINS = [
  { slug: 'sirkeci', anyLine: ['B1', 'T6'], coord: [28.9779867, 41.0150746] },
  { slug: 'sirkeci', anyLine: ['T1'], coord: [28.975714, 41.014736] },
  { slug: 'halkali', anyLine: ['M11', 'B1', 'B2'], coord: [28.7663106, 41.0191217] },
  { slug: 'incirli', anyLine: ['M3'], coord: [28.875023, 40.997703] },
  // snap:true → place the dot at the nearest point ON the line to this coord, so a
  // mid-line station stays on the track (no zigzag from pinning a dot off the line).
  { slug: 'haznedar', anyLine: ['M3'], coord: [28.871663, 41.004636], snap: true },
]
for (const pin of COORD_PINS) {
  for (const s of Object.values(stations)) {
    if (slug(s.name.tr) !== pin.slug) continue
    if (!pin.anyLine.some((l) => s.lines.includes(l))) continue
    s.coord = [Number(pin.coord[0].toFixed(6)), Number(pin.coord[1].toFixed(6))]
  }
}
// snap:true pins: project onto the matching line and use that on-track point for both
// the dot and the slice endpoint, so the line passes straight through (no spike).
for (const pin of COORD_PINS) {
  if (!pin.snap) continue
  for (const ld of lineData) {
    if (!pin.anyLine.includes(ld.cfg.code) || !ld.lineFeature || !ld.snapped) continue
    const idx = ld.ids.findIndex((id) => slug(stations[id].name.tr) === pin.slug)
    if (idx < 0) continue
    const np = turf.nearestPointOnLine(ld.lineFeature, turf.point(pin.coord), { units: 'kilometers' })
    const coord = [Number(np.geometry.coordinates[0].toFixed(6)), Number(np.geometry.coordinates[1].toFixed(6))]
    stations[ld.ids[idx]].coord = coord
    ld.snapped[idx] = { loc: np.properties.location, distM: 0, coord }
  }
}

// explicit segment geometry overrides (keyed lineCode|fromSlug|toSlug). Used where the
// OSM centerline disagrees with the real alignment. B1 Marmaray Sirkeci→Üsküdar runs
// under the Kennedy Cad. shore (reusing T6's verified coastal trace), not inland.
const GEOM_PINS = {
  'B1|sirkeci|uskudar': [
    [28.980961, 41.015329],
    [28.981968, 41.015586],
    [28.983565, 41.016111],
    [28.984298, 41.016191],
    [28.985519, 41.016812],
    [28.987019, 41.017459],
    [29.006956, 41.024167],
    [29.01104, 41.025213],
  ],
}

// Clean a sliced BRT segment so it hugs the busway: keep only vertices that progress
// monotonically along the A→B chord and don't spike sideways. The Metrobüs OSM relation
// is 188 fragmented ways with out-and-back spurs (access ramps, pull-outs) and gap-bridge
// darts (jumps up to ~1.3 km); naive slicing inherits these as zigzags that also make the
// simulated bus reverse at stops. A gentle road bend still advances monotonically toward B
// and stays near the chord, so it survives; a spur reverses or jumps far off-axis and is
// dropped — leaving a single clean line down the middle of the road.
function cleanSpurs(coords, a, b) {
  if (coords.length <= 2) return coords
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return [a, b]
  const chordM = hav(a, b)
  // The real discriminator between a road bend and a spur is BACKTRACKING (monotone t),
  // not lateral distance — the D100 genuinely bows up to ~0.22·chord off the chord on
  // curved stretches (e.g. Acıbadem→Uzunçayır), so the lateral cap must stay well above
  // that and only catch absurd off-axis darts; the monotone-t test removes the spurs.
  const maxPerp = Math.max(450, chordM * 0.4) // lateral sanity cap (m): keeps real bends
  const projT = (p) => ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 // 0..1 along chord
  const out = [coords[0]]
  let lastT = 0
  for (let i = 1; i < coords.length - 1; i++) {
    const p = coords[i]
    const t = projT(p)
    if (t <= lastT + 1e-4 || t >= 0.9999) continue // backtrack / past end → drop
    if (hav(p, [a[0] + dx * t, a[1] + dy * t]) > maxPerp) continue // lateral spike → drop
    out.push(p)
    lastT = t
  }
  out.push(coords[coords.length - 1])
  return out
}

// pass 2: segments — pure centerline slices (endpoints forced to the station dots)
for (const ld of lineData) {
  const code = ld.cfg.code
  const ids = ld.ids
  const snapped = ld.snapped
  const lineFeature = ld.lineFeature
  const segs = []
  let sliced = 0
  let chord = 0
  for (let i = 0; i < ids.length - 1; i++) {
    const aC = stations[ids[i]].coord
    const bC = stations[ids[i + 1]].coord
    let geometry = null
    const pinKey = `${code}|${slug(stations[ids[i]].name.tr)}|${slug(stations[ids[i + 1]].name.tr)}`
    if (GEOM_PINS[pinKey]) {
      geometry = [aC, ...GEOM_PINS[pinKey].map((p) => [p[0], p[1]]), bC]
      sliced++
    }
    if (
      !geometry &&
      snapped &&
      snapped[i].distM < SNAP_TOL_M &&
      snapped[i + 1].distM < SNAP_TOL_M &&
      Math.abs(snapped[i + 1].loc - snapped[i].loc) > 0.005
    ) {
      try {
        // slice between this line's OWN snapped points (always on its track), so the
        // line follows the rail even where the shared transfer dot sits on another line
        const aSnap = snapped[i].coord
        const bSnap = snapped[i + 1].coord
        const sl = turf.lineSlice(turf.point(aSnap), turf.point(bSnap), lineFeature)
        const simp = turf.simplify(turf.lineString(sl.geometry.coordinates), { tolerance: 0.00003, highQuality: false })
        let coords = simp.geometry.coordinates
        if (hav(coords[0], aSnap) > hav(coords[coords.length - 1], aSnap)) coords = coords.slice().reverse()
        if (ld.cfg.cleanSpurs) coords = cleanSpurs(coords, aSnap, bSnap)
        let len = 0
        for (let k = 1; k < coords.length; k++) len += hav(coords[k - 1], coords[k])
        const ch = hav(aSnap, bSnap)
        if (coords.length >= 2 && len <= ch * 1.9 && len >= ch * 0.85) {
          geometry = coords.map((p) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))])
          sliced++
        }
      } catch {
        /* chord */
      }
    }
    if (!geometry) {
      geometry = [aC, bC]
      chord++
    }
    // pin endpoints exactly onto the station dots so every line meets at the shared
    // interchange circle — fixes frayed/short ends at hubs (Yenikapı, Halkalı, Sirkeci)
    geometry[0] = [aC[0], aC[1]]
    geometry[geometry.length - 1] = [bC[0], bC[1]]
    let lengthM = 0
    for (let k = 1; k < geometry.length; k++) lengthM += hav(geometry[k - 1], geometry[k])
    segs.push({ id: `${code}:${i}`, lineId: code, fromIndex: i, from: ids[i], to: ids[i + 1], geometry, lengthM: Math.round(lengthM) })
  }
  segments[code] = segs
  report.push({ code, st: ids.length, sliced, chord, geom: ld.centerline ? 'osm' : 'none' })
}

// M1A & M1B share the Yenikapı→Otogar trunk (same station ids). Copy M1A's geometry onto
// M1B's matching segments so the trunk renders as a single clean line (no offset "lens"),
// while both lines stay present on the trunk for click-to-choose disambiguation.
if (segments.M1A && segments.M1B) {
  const byPair = new Map(segments.M1A.map((s) => [`${s.from}|${s.to}`, s.geometry]))
  for (const s of segments.M1B) {
    const g = byPair.get(`${s.from}|${s.to}`)
    if (!g) continue
    s.geometry = g.map((p) => [p[0], p[1]])
    let L = 0
    for (let k = 1; k < s.geometry.length; k++) L += hav(s.geometry[k - 1], s.geometry[k])
    s.lengthM = Math.round(L)
  }
}

// ---------------------------------------------------------------------------
// 4a) terminus + POI flags (official map sign conventions)
// ---------------------------------------------------------------------------
for (const ld of lineData) {
  const ids = lines[ld.cfg.code].stations
  if (ids.length >= 2) {
    stations[ids[0]].isTerminus = true
    stations[ids[ids.length - 1]].isTerminus = true
  }
}
const YHT = new Set(['halkali', 'sogutlucesme', 'bakirkoy', 'pendik', 'gebze', 'bostanci'])
for (const s of Object.values(stations)) {
  const lc = s.name.tr.toLocaleLowerCase('tr')
  if (/havaliman|havaalan|airport/.test(lc)) s.poi = 'airport'
  else if (/otogar/.test(lc)) s.poi = 'coach'
  else if (YHT.has(slug(s.name.tr))) s.poi = 'yht'
}

// ---------------------------------------------------------------------------
// 4b) walking transfers between nearby stations on different lines
// ---------------------------------------------------------------------------
const WALK_MAX = 350 // meters
// station-name pairs that are within walking distance but are NOT a real interchange
// (slug pair, sorted). T3 nostalgic tram loops around Kadıköy so several stops fall
// within range of M4 Kadıköy, but the only real interchange is at İskele Camii.
const NO_TRANSFER = new Set([
  'gulhane|sirkeci',
  'kadikoy|kadikoy-ido',
  'kadikoy|muhurdar',
  'damga-sokak|kadikoy',
])
const blockKey = (a, b) => [slug(a.name.tr), slug(b.name.tr)].sort().join('|')
const transfers = []
{
  const arr = Object.values(stations)
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i]
      const b = arr[j]
      const d = hav(a.coord, b.coord)
      if (d > WALK_MAX) continue
      if (NO_TRANSFER.has(blockKey(a, b))) continue
      // skip if they connect no new line (b's lines ⊆ a's lines)
      const setA = new Set(a.lines)
      if (b.lines.every((l) => setA.has(l))) continue
      const walkSec = Math.round(d / 1.25) + 30
      transfers.push({ a: a.id, b: b.id, walkSec, distM: Math.round(d) })
      ;(a.transfers ??= []).push(b.id)
      ;(b.transfers ??= []).push(a.id)
    }
  }

  // forced interchanges just beyond the auto-link radius (verified real transfers)
  const FORCE_TRANSFER = [
    { slug: 'seyrantepe', a: 'M2', b: 'F3' },
    { slug: 'bogazici-u-hisarustu', a: 'M6', b: 'F4' },
  ]
  for (const fp of FORCE_TRANSFER) {
    const sa = arr.find((s) => slug(s.name.tr) === fp.slug && s.lines.includes(fp.a))
    const sb = arr.find((s) => slug(s.name.tr) === fp.slug && s.lines.includes(fp.b))
    if (!sa || !sb || sa === sb) continue
    const linked = transfers.some((t) => (t.a === sa.id && t.b === sb.id) || (t.a === sb.id && t.b === sa.id))
    if (!linked) {
      const d = hav(sa.coord, sb.coord)
      transfers.push({ a: sa.id, b: sb.id, walkSec: Math.round(d / 1.25) + 30, distM: Math.round(d) })
      ;(sa.transfers ??= []).push(sb.id)
      ;(sb.transfers ??= []).push(sa.id)
    }
  }

  // M1A & M1B are one line family (shared trunk) — a stop served only by them is not an
  // interchange. Count distinct families instead of raw line codes.
  const familyOf = (code) => (code === 'M1A' || code === 'M1B' ? 'M1' : code)
  for (const s of arr)
    s.isTransfer = new Set(s.lines.map(familyOf)).size > 1 || (s.transfers?.length ?? 0) > 0
}

// ---------------------------------------------------------------------------
// 5) run-times, schedules, profiles  —  KINEMATIC REVERSE-ENGINEERING CALIBRATION
// ---------------------------------------------------------------------------
// Instead of global cruise/dwell/accel constants, each main line's run-times are
// reverse-engineered so the simulated one-way time locks to the operator's OFFICIAL
// "sefer süresi". The model per segment is a trapezoidal/triangular kinematic profile:
//   d ≥ d* :  run = d/cruise + cruise/aEff           (reaches cruise)
//   d < d* :  run = 2·√(d/aEff)                        (too short → triangular, replaces MIN_RUN)
//   d* = cruise²/aEff ,  aEff = 2·aAcc·aDec/(aAcc+aDec)  (asymmetric accel/decel → harmonic mean)
// We solve `cruise` numerically so Σ run·curveFactor + Σ dwell = officialSec, capped at
// the vehicle's design Vmax (CBTC ceiling). Dwell is per-station (transfer hubs longer).
// Verified official data (one-way min, design Vmax km/h, accel/decel m/s²):
const LINE_CALIBRATION = {
  M1A: { min: 35, vmax: 80, aAcc: 1.0, aDec: 1.3 },
  M1B: { min: 25, vmax: 80, aAcc: 1.0, aDec: 1.3 },
  M2: { min: 32, vmax: 80, aAcc: 1.0, aDec: 1.3 },
  M3: { min: 44, vmax: 80, aAcc: 1.0, aDec: 1.3 },
  M4: { min: 52, vmax: 80, aAcc: 1.0, aDec: 1.3 },
  M5: { min: 50, vmax: 80, aAcc: 1.1, aDec: 1.3 },
  M6: { min: 7, vmax: 80, aAcc: 1.0, aDec: 1.3 },
  M7: { min: 36, vmax: 80, aAcc: 1.1, aDec: 1.3 },
  M8: { min: 26, vmax: 80, aAcc: 1.1, aDec: 1.3 },
  M9: { min: 26, vmax: 80, aAcc: 1.1, aDec: 1.3 },
  M11: { min: 57, vmax: 120, aAcc: 1.0, aDec: 1.2 },
  B1: { min: 108, vmax: 100, aAcc: 0.9, aDec: 1.1 },
  T1: { min: 65, vmax: 70, aAcc: 1.1, aDec: 1.3 },
  T3: { min: 20, vmax: 40, aAcc: 1.0, aDec: 1.3 }, // Kadıköy–Moda heritage street tram (slow, frequent stops)
  T4: { min: 45, vmax: 70, aAcc: 1.1, aDec: 1.3 },
  T5: { min: 32, vmax: 70, aAcc: 1.1, aDec: 1.3 },
  T6: { min: 20, vmax: 60, aAcc: 1.0, aDec: 1.3 }, // Sirkeci–Kazlıçeşme banliyö (~20 min from official table)
}
// per-station dwell tiers (s): standard intermediate stop vs major transfer hub
const DWELL_TIER = {
  metro: { std: 22, hub: 35 }, marmaray: { std: 30, hub: 50 }, suburban: { std: 30, hub: 45 },
  tram: { std: 16, hub: 25 }, brt: { std: 18, hub: 25 }, funicular: { std: 30, hub: 30 }, cablecar: { std: 25, hub: 25 },
}
const CURVE_K = 0.6 // geometry penalty: a segment bowing s× off its chord runs (1+0.6·(s−1)) slower
const TERM = { metro: 240, tram: 180, funicular: 120, cablecar: 90, marmaray: 300, suburban: 300, brt: 120 }
// Weekend-night service ("Gece Metrosu", Fri→Sat & Sat→Sun nights, 00:00–05:30) overnight
// headway per line, in seconds. Official Gece Metrosu (metro.istanbul) covers exactly
// M1A,M1B,M2,M4,M5,M6,M7 at ~20 min. M11 (airport) runs Fri/Sat nights 00:01–05:30 every
// 30 min as a separate airport arrangement. Marmaray (B1) has its own limited extension in
// §5c; the B1S short-turn has no night service. Metrobüs is genuine 24/7 (see ALLDAY).
const NIGHT_HW = { M1A: 1200, M1B: 1200, M2: 1200, M4: 1200, M5: 1200, M6: 1200, M7: 1200, M11: 1800 }
// Genuine 24/7 lines — run every night, every day (not just weekends). Metrobüs (İETT) is the
// canonical one: continuous 24-hour service, Söğütlüçeşme ⇄ Beylikdüzü.
const ALLDAY = new Set(['METROBUS'])
const ALLDAY_NIGHT_HW = 900 // overnight (00:00–06:00) headway for 24/7 lines (~15 min)

// Official İşletme Saatleri (Metro İstanbul) — overrides the stale/wrong API first–last (e.g.
// the API reports M1A 00:35 and T1 23:36, while the operator publishes 06:00–00:00). Lines with
// special hours keep their config/API values (M11 06:00–00:40, B1, T3 day-varying, cable cars…).
const HOURS = {
  M1A: ['06:00', '00:00'], M1B: ['06:00', '00:00'], M2: ['06:00', '00:00'], M3: ['06:00', '00:00'],
  M4: ['06:00', '00:00'], M6: ['06:00', '00:00'], M7: ['06:00', '00:00'], M8: ['06:00', '00:00'],
  M9: ['06:00', '00:00'], T1: ['06:00', '00:00'], T4: ['06:00', '00:00'], T5: ['06:00', '00:00'],
  F1: ['06:00', '00:00'],
}
// peak (busiest-hour) headway in seconds, from Metro İstanbul official "Sefer Sıklığı (pik)"
const PEAK = { M1A: 360, M1B: 240, M2: 235, M3: 420, M4: 300, M5: 300, M6: 300, M7: 240, M8: 420, M9: 540 }
// fallback kinematics for lines without explicit calibration (trams T2/T3/T6, funiculars, B2, BRT…)
const FALLBACK = {
  metro: { vmax: 80, aAcc: 1.0, aDec: 1.3 }, tram: { vmax: 70, aAcc: 1.1, aDec: 1.3 },
  funicular: { vmax: 40, aAcc: 0.9, aDec: 1.0 }, cablecar: { vmax: 25, aAcc: 0.7, aDec: 0.8 },
  marmaray: { vmax: 100, aAcc: 0.9, aDec: 1.1 }, suburban: { vmax: 100, aAcc: 0.9, aDec: 1.1 }, brt: { vmax: 60, aAcc: 1.0, aDec: 1.2 },
}
const FALLBACK_CRUISE = { metro: 12.5, tram: 6.5, funicular: 4.5, cablecar: 5.0, marmaray: 16.0, suburban: 16.0, brt: 12.5 }

const aEffOf = (aAcc, aDec) => (2 * aAcc * aDec) / (aAcc + aDec)
// kinematic single-segment run time (s): trapezoidal if it can reach cruise, else triangular
function kinRunSec(d, V, aEff) {
  const dstar = (V * V) / aEff
  return d >= dstar ? d / V + V / aEff : 2 * Math.sqrt(Math.max(0, d) / aEff)
}
// solve cruise V (m/s) so Σ kinRun·curve + Σdwell = targetSec; clamp at Vmax·0.95 (CBTC ceiling)
function solveCruise(lens, curve, sumDwell, targetSec, aEff, vmaxMs) {
  const total = (V) => {
    let t = sumDwell
    for (let i = 0; i < lens.length; i++) t += kinRunSec(lens[i], V, aEff) * curve[i]
    return t
  }
  const cap = vmaxMs * 0.95
  const minTime = total(cap) // fastest achievable (running flat-out at the cap)
  if (targetSec <= minTime) return { V: cap, capped: true, minTime } // V_max kapanı
  let lo = 0.5, hi = cap
  for (let it = 0; it < 60; it++) {
    const mid = (lo + hi) / 2
    if (total(mid) > targetSec) lo = mid // too slow → go faster
    else hi = mid
  }
  return { V: (lo + hi) / 2, capped: false, minTime }
}

const parseHM = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '')
  return m ? +m[1] * 60 + +m[2] : null
}

// Headway calibration (Katman A — frequency). Multipliers on each line's PEAK headway per
// band, tuned to Metro İstanbul's real operation. The old model used evening = peak×2.2,
// which produced ~13 min late on a Sunday when the platform reality was ~7–8 min (field
// observation: M3, Sun 22:30 ≈ 7.5 min). Evening/weekend bands are now much tighter. The
// weekend-night Gece Metrosu headways are per-line in NIGHT_HW. Fully static/offline/deterministic.
const HEADWAY_CAL = {
  wkEarly: 1.4, // weekday before the morning peak
  wkMid: 1.3, // weekday midday (between peaks)
  wkEvening: 1.4, // weekday after 20:00
  weMorning: 1.4, // weekend morning
  weMid: 1.25, // weekend midday/afternoon
  weEvening: 1.07, // weekend after 20:00  (M3 official peak 420 × 1.07 ≈ 7.5 min, matching the field observation)
}
const schedules = {}
const profiles = {}
const fmtHM = (m) => {
  const x = ((Math.round(m) % 1440) + 1440) % 1440
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`
}
for (const code of Object.keys(lines)) {
  const L = lines[code]
  const mode = L.mode
  const peak = lineData.find((d) => d.cfg.code === code)?.cfg.peak ?? PEAK[code] ?? (mode === 'metro' ? 300 : mode === 'tram' ? 360 : 240)
  const hw = (mult) => Math.round(peak * mult)

  const oh = HOURS[code]
  let first = parseHM(oh ? oh[0] : L.firstTime)
  if (first == null || first < 240) first = 360
  let last = parseHM(oh ? oh[1] : L.lastTime)
  if (last == null) last = 1440
  if (last < 300) last += 1440
  // reflect the REAL service window on the line object so the line-detail panel shows the
  // official operating hours (the raw API firstTime is often a stray value like "00:35");
  // 24/7 lines (Metrobüs) show 00:00–23:59.
  if (ALLDAY.has(code)) {
    L.firstTime = '00:00'
    L.lastTime = '23:59'
  } else {
    L.firstTime = fmtHM(first)
    L.lastTime = fmtHM(last)
  }

  const weekday = [
    { startMin: first, endMin: 420, headwaySec: hw(HEADWAY_CAL.wkEarly) },
    { startMin: 420, endMin: 600, headwaySec: peak },
    { startMin: 600, endMin: 960, headwaySec: hw(HEADWAY_CAL.wkMid) },
    { startMin: 960, endMin: 1200, headwaySec: peak },
    { startMin: 1200, endMin: last, headwaySec: hw(HEADWAY_CAL.wkEvening) },
  ].filter((x) => x.endMin > x.startMin)
  const weekend = [
    { startMin: first, endMin: 600, headwaySec: hw(HEADWAY_CAL.weMorning) },
    { startMin: 600, endMin: 1200, headwaySec: hw(HEADWAY_CAL.weMid) },
    { startMin: 1200, endMin: last, headwaySec: hw(HEADWAY_CAL.weEvening) },
  ].filter((x) => x.endMin > x.startMin)
  // Weekend-night "Gece Metrosu" overnight band (00:00–05:30). In İstanbul this runs ONLY on
  // the Friday→Saturday and Saturday→Sunday nights, whose overnight hours land on the SATURDAY
  // and SUNDAY calendar days — so it is attached to the saturday/sunday day-types only (never
  // weekday). That makes weekday nights AND the Sunday→Monday night (early Monday = weekday
  // day-type) close after the last run with no after-midnight ghost trains.
  const weekendNight = NIGHT_HW[code] ? [{ startMin: 0, endMin: 330, headwaySec: NIGHT_HW[code] }] : []
  // 24/7 lines (Metrobüs): a sparse overnight band on EVERY day-type (00:00–06:00); the daytime
  // bands above already cover 06:00 onward, so together they give continuous round-the-clock service.
  const allDayNight = ALLDAY.has(code) ? [{ startMin: 0, endMin: 360, headwaySec: ALLDAY_NIGHT_HW }] : []

  const segs = segments[code] || []
  const ids = L.stations
  const nSt = ids.length
  const tier = DWELL_TIER[mode] || DWELL_TIER.metro
  // per-station dwell: 0 at the two termini, hub-vs-standard in between
  let dwellByIdx = ids.map((id, i) =>
    i === 0 || i === nSt - 1 ? 0 : stations[id].isTransfer ? tier.hub : tier.std,
  )
  // geometry penalty per segment (sinuosity = path/chord), capped at +42%
  const curve = segs.map((s) => {
    const g = s.geometry
    const chord = hav(g[0], g[g.length - 1]) || 1
    return 1 + CURVE_K * Math.max(0, Math.min(0.7, s.lengthM / chord - 1))
  })

  const cal = LINE_CALIBRATION[code]
  const phys = cal ?? FALLBACK[mode] ?? FALLBACK.metro
  const aEff = aEffOf(phys.aAcc, phys.aDec)
  let cruiseMps
  let capped = false
  if (cal && segs.length) {
    // reverse-engineer cruise so Σ run·curve + Σ dwell locks to the official one-way time
    const lens = segs.map((s) => s.lengthM)
    const sumDwell = dwellByIdx.reduce((a, b) => a + b, 0)
    const sol = solveCruise(lens, curve, sumDwell, cal.min * 60, aEff, cal.vmax / 3.6)
    cruiseMps = sol.V
    capped = sol.capped
    if (capped) {
      // infeasible even at Vmax → trim dwell to absorb the deficit (floored at 12 s)
      const runOnly = sol.minTime - sumDwell
      const wantDwell = Math.max(0, cal.min * 60 - runOnly)
      const k = sumDwell > 0 ? wantDwell / sumDwell : 0
      dwellByIdx = dwellByIdx.map((d) => (d > 0 ? Math.max(12, Math.round(d * k)) : 0))
    }
    segs.forEach((s, i) => {
      s.runTimeS = Math.max(8, Math.round(kinRunSec(s.lengthM, cruiseMps, aEff) * curve[i]))
    })
  } else {
    // uncalibrated line: fixed-cruise kinematic fallback (no official target to lock to)
    cruiseMps = FALLBACK_CRUISE[mode] || 11
    segs.forEach((s, i) => {
      s.runTimeS = Math.max(10, Math.round(kinRunSec(s.lengthM, cruiseMps, aEff) * curve[i]))
    })
  }

  schedules[code] = {
    lineId: code,
    firstDepartureMin: first,
    lastDepartureMin: last,
    // weekday closes after the last run (covers Mon–Fri AND the Sunday→Monday night, which is a
    // weekday day-type) — unless the line is 24/7 (allDayNight on every day). saturday/sunday
    // additionally carry the weekend-night band = the Friday→Saturday & Saturday→Sunday Gece Metrosu.
    bands: {
      weekday: [...allDayNight, ...weekday],
      saturday: [...allDayNight, ...weekendNight, ...weekend],
      sunday: [...allDayNight, ...weekendNight, ...weekend],
    },
    dwellSec: tier.std, // representative single value (journey planner); detail in dwellByIdx
    dwellByIdx,
    terminalLayoverSec: TERM[mode],
    nightService: ALLDAY.has(code) || Boolean(NIGHT_HW[code]),
    calibration: {
      cruiseMps: Number(cruiseMps.toFixed(2)),
      cruiseKmh: Number((cruiseMps * 3.6).toFixed(1)),
      aAcc: phys.aAcc,
      aDec: phys.aDec,
      aEff: Number(aEff.toFixed(3)),
      vmaxKmh: phys.vmax,
      accelSec: Number((cruiseMps / aEff).toFixed(1)),
      capped,
      officialMin: cal ? cal.min : null,
    },
  }

  // profiles: arrival time at each station (matches the engine's arrive/depart chain)
  const cumD = [0]
  const cumT = [0] // arrive[0] = 0
  let dep = 0
  for (let i = 0; i < segs.length; i++) {
    cumD.push(cumD[cumD.length - 1] + segs[i].lengthM)
    const arr = dep + segs[i].runTimeS
    cumT.push(arr)
    dep = arr + (i === segs.length - 1 ? 0 : dwellByIdx[i + 1])
  }
  profiles[code] = {
    lineId: code,
    cumDistanceM: cumD,
    totalLengthM: cumD[cumD.length - 1],
    cumTimeSec: cumT,
    oneWayTimeSec: cumT[cumT.length - 1],
  }
}

// ---------------------------------------------------------------------------
// 5b) M2 Seyrantepe branch — route-pattern sibling (the only real fork in the network)
//   M2 main is Yenikapı–Hacıosman (Seyrantepe dropped). Here M2S shares M2's trunk
//   (Yenikapı→Sanayi Mahallesi) geometry + run-times, then spurs to Seyrantepe. Modeled
//   as a sibling service in the same family as M2 (exactly like M1A/M1B), so the trunk is
//   not a false interchange and the interpolation never teleports across the fork.
;(() => {
  const M2 = lines.M2
  const m2segs = segments.M2
  const m2sched = schedules.M2
  if (!M2 || !m2segs || !m2sched) return
  // Seyrantepe already exists as a cluster (F3 funicular terminus); reuse it, else create.
  let seyId = Object.keys(stations).find((id) => slug(stations[id].name.tr) === 'seyrantepe')
  if (!seyId) {
    const apiSey = (apiStationsByCode.get('M2') || []).find((s) => slug(s.name) === 'seyrantepe')
    if (!apiSey) return
    seyId = 'seyrantepe'
    stations[seyId] = {
      id: seyId, name: { tr: apiSey.name, en: apiSey.name },
      coord: [Number(apiSey.coord[0].toFixed(6)), Number(apiSey.coord[1].toFixed(6))],
      lines: [], isTransfer: false,
      accessibility: { stepFree: false, elevator: false, escalator: false }, facilities: [], extra: {},
    }
  }
  const jIdx = M2.stations.findIndex((id) => slug(stations[id].name.tr) === 'sanayi-mahallesi')
  if (jIdx < 0) return
  const trunkIds = M2.stations.slice(0, jIdx + 1)
  const m2sIds = [...trunkIds, seyId]
  if (!stations[seyId].lines.includes('M2S')) stations[seyId].lines = ['M2S', ...stations[seyId].lines]
  stations[seyId].isTerminus = true
  stations[seyId].isTransfer = stations[seyId].lines.length > 1

  lines.M2S = {
    id: 'M2S', code: 'M2', name: { tr: 'M2 · Seyrantepe', en: 'M2 · Seyrantepe' },
    mode: 'metro', status: 'operational', color: M2.color, onColor: M2.onColor,
    stations: m2sIds, firstTime: M2.firstTime, lastTime: M2.lastTime, order: M2.order + 0.5,
  }
  // segments: copy M2 trunk segments, then a straight spur Sanayi→Seyrantepe
  const byPair = new Map(m2segs.map((s) => [`${s.from}|${s.to}`, s]))
  const segs = []
  for (let i = 0; i < trunkIds.length - 1; i++) {
    const a = trunkIds[i]
    const b = trunkIds[i + 1]
    const src = byPair.get(`${a}|${b}`)
    if (src) segs.push({ id: `M2S:${i}`, lineId: 'M2S', fromIndex: i, from: a, to: b, geometry: src.geometry.map((p) => [p[0], p[1]]), lengthM: src.lengthM, runTimeS: src.runTimeS })
    else {
      const aC = stations[a].coord
      const bC = stations[b].coord
      segs.push({ id: `M2S:${i}`, lineId: 'M2S', fromIndex: i, from: a, to: b, geometry: [aC, bC], lengthM: Math.round(hav(aC, bC)) })
    }
  }
  const jId = trunkIds[trunkIds.length - 1]
  const jC = stations[jId].coord
  const sC = stations[seyId].coord
  const spurLen = Math.round(hav(jC, sC))
  const calM2 = m2sched.calibration
  const aEff = calM2 ? calM2.aEff : aEffOf(1.0, 1.3)
  const V = calM2 ? calM2.cruiseMps : 12.5
  segs.push({ id: `M2S:${trunkIds.length - 1}`, lineId: 'M2S', fromIndex: trunkIds.length - 1, from: jId, to: seyId, geometry: [jC, sC], lengthM: spurLen, runTimeS: Math.max(8, Math.round(kinRunSec(spurLen, V, aEff))) })
  segments.M2S = segs
  // schedule: the Sanayi Mahallesi–Seyrantepe branch shuttle runs a CONSTANT 8.5 min all day
  // (official "Sefer Sıklığı: 8,5 dk gün boyu"), so daytime bands get a flat 510 s headway
  // regardless of trunk peak/off-peak; only the overnight night-metro band stays sparse
  // (trunk night cadence ×2.5). Band start/end windows are inherited from M2.
  const tier = DWELL_TIER.metro
  const dwellByIdx = m2sIds.map((id, i) => (i === 0 || i === m2sIds.length - 1 ? 0 : stations[id].isTransfer ? tier.hub : tier.std))
  const BRANCH_HW = 510 // 8.5 min, constant during operating hours
  const branch = (arr) => arr.map((b) => ({ ...b, headwaySec: b.startMin < 300 ? Math.round(b.headwaySec * 2.5) : BRANCH_HW }))
  schedules.M2S = {
    lineId: 'M2S', firstDepartureMin: m2sched.firstDepartureMin, lastDepartureMin: m2sched.lastDepartureMin,
    bands: { weekday: branch(m2sched.bands.weekday), saturday: branch(m2sched.bands.saturday), sunday: branch(m2sched.bands.sunday) },
    dwellSec: tier.std, dwellByIdx, terminalLayoverSec: TERM.metro, nightService: m2sched.nightService,
    calibration: calM2 ? { ...calM2, officialMin: null } : undefined,
  }
  const cumD = [0]
  const cumT = [0]
  let dep = 0
  for (let i = 0; i < segs.length; i++) {
    cumD.push(cumD[cumD.length - 1] + segs[i].lengthM)
    const arr = dep + segs[i].runTimeS
    cumT.push(arr)
    dep = arr + (i === segs.length - 1 ? 0 : dwellByIdx[i + 1])
  }
  profiles.M2S = { lineId: 'M2S', cumDistanceM: cumD, totalLengthM: cumD[cumD.length - 1], cumTimeSec: cumT, oneWayTimeSec: cumT[cumT.length - 1] }
  console.log(`M2S branch: ${m2sIds.length} stations, spur ${spurLen} m → Seyrantepe`)
})()

// ---------------------------------------------------------------------------
// 5c) Marmaray (B1) weekend-night service — NOT a 24h line. Official: Halkalı–Gebze runs
//   ~15 min by day; on the Friday→Saturday and Saturday→Sunday nights ONLY, trains after
//   22:50 run every 30 min with the last Gebze departure ~01:20, then it closes until first
//   service. So instead of the generic "Gece Metrosu" band (B1 is left out of NIGHT_HW), we
//   attach a 30-min overnight tail to the Saturday/Sunday day-types and extend the Saturday
//   evening. Weekday and the Sunday→Monday night close normally → no after-midnight ghosts.
;(() => {
  const s = schedules.B1
  if (!s) return
  const PK = 900 // 15-min full-line peak (official Gebze–Halkalı)
  const hw = (m) => Math.round(PK * m)
  const N = 1800 // 30 min, official "22:50 sonrası 30 dk"
  const day = [
    { startMin: 360, endMin: 600, headwaySec: hw(HEADWAY_CAL.weMorning) },
    { startMin: 600, endMin: 1200, headwaySec: hw(HEADWAY_CAL.weMid) },
    { startMin: 1200, endMin: 1370, headwaySec: hw(HEADWAY_CAL.weEvening) }, // …–22:50
  ]
  const tail = { startMin: 20, endMin: 85, headwaySec: N } // 00:20/00:50/01:20 (real last Gebze 01:20)
  // Saturday day-type: Fri→Sat tail + day + 22:50→24:00 30-min (start of the Sat→Sun night)
  s.bands.saturday = [tail, ...day, { startMin: 1370, endMin: 1440, headwaySec: N }]
  // Sunday day-type: Sat→Sun tail + day, then a NORMAL close (Sun→Mon is a weekday night)
  s.bands.sunday = [tail, ...day, { startMin: 1370, endMin: 1400, headwaySec: hw(HEADWAY_CAL.weEvening) }]
})()

// ---------------------------------------------------------------------------
// 5d) Marmaray short-turns as HIDDEN sub-lines of B1 — Marmaray stays a SINGLE line in the UI;
//   its trains are differentiated only by destination ("Pendik treni", "Ataköy treni",
//   "Zeytinburnu treni"). The full Gebze–Halkalı line runs ~15 min; over the Ataköy–Pendik core
//   a short-turn overlaps it (~8 min combined, official). These sub-lines share B1's geometry/
//   run-times on a contiguous sub-path and are flagged hidden+parent so they spawn trains on the
//   map but never appear as separate lines in lists, search, the legend or journey routing.
//   Naming is by DESTINATION (towardId): "Ataköy treni" departs Pendik (westbound), "Pendik
//   treni" departs Ataköy (eastbound). After 20:50 the Pendik-departing westbound terminates at
//   Zeytinburnu, so B1S (→Ataköy) ends at 20:50 and B1Z (→Zeytinburnu) takes over until 22:40.
;(() => {
  const B1 = lines.B1
  const b1segs = segments.B1
  const b1sched = schedules.B1
  if (!B1 || !b1segs || !b1sched) return
  const tier = DWELL_TIER.marmaray
  const idxOf = (sid) => B1.stations.findIndex((id) => id === sid || id.startsWith(sid))

  // build a hidden sub-line on B1's contiguous sub-path [aId..bId] with the given bands
  const sub = (childId, aId, bId, bands, nameTr) => {
    const ia = idxOf(aId)
    const ib = idxOf(bId)
    if (ia < 0 || ib < 0) return
    const lo = Math.min(ia, ib)
    const hi = Math.max(ia, ib)
    const ids = B1.stations.slice(lo, hi + 1)
    lines[childId] = {
      id: childId, code: B1.code, name: { tr: nameTr, en: nameTr },
      mode: 'marmaray', status: 'operational', color: B1.color, onColor: B1.onColor,
      stations: ids, firstTime: B1.firstTime, lastTime: B1.lastTime,
      order: (B1.order ?? 50) + 0.5, hidden: true, parent: 'B1',
    }
    segments[childId] = []
    for (let i = lo; i < hi; i++) {
      const s = b1segs[i]
      segments[childId].push({ id: `${childId}:${i - lo}`, lineId: childId, fromIndex: i - lo, from: s.from, to: s.to, geometry: s.geometry.map((p) => [p[0], p[1]]), lengthM: s.lengthM, runTimeS: s.runTimeS })
    }
    const dwellByIdx = ids.map((id, i) => (i === 0 || i === ids.length - 1 ? 0 : stations[id]?.isTransfer ? tier.hub : tier.std))
    schedules[childId] = {
      lineId: childId, firstDepartureMin: bands[0].startMin, lastDepartureMin: bands[bands.length - 1].endMin,
      bands: { weekday: bands, saturday: bands, sunday: bands },
      dwellSec: tier.std, dwellByIdx, terminalLayoverSec: TERM.marmaray, nightService: false,
      calibration: b1sched.calibration ? { ...b1sched.calibration, officialMin: null } : undefined,
    }
    const cumD = [0]
    const cumT = [0]
    let dep = 0
    for (let i = 0; i < segments[childId].length; i++) {
      cumD.push(cumD[cumD.length - 1] + segments[childId][i].lengthM)
      const arr = dep + segments[childId][i].runTimeS
      cumT.push(arr)
      dep = arr + (i === segments[childId].length - 1 ? 0 : dwellByIdx[i + 1])
    }
    profiles[childId] = { lineId: childId, cumDistanceM: cumD, totalLengthM: cumD[cumD.length - 1], cumTimeSec: cumT, oneWayTimeSec: cumT[cumT.length - 1] }
    console.log(`${childId}: ${ids.length} st (${nameTr}), ${(cumT[cumT.length - 1] / 60).toFixed(1)} min one-way`)
  }

  // 16-min short-turn (deliberately ≠ B1's 15 min) so the two never persistently pair up;
  // combined with B1 ⇒ ~7.7 min on the Ataköy–Pendik core (official 8 min). Runs every day.
  const HW = 960
  const flat = (startMin, endMin) => [{ startMin, endMin, headwaySec: HW }]
  // Ataköy ⇄ Pendik, 06:00–20:50. "Pendik treni" (Ataköy→Pendik) & "Ataköy treni" (Pendik→Ataköy).
  sub('B1S', 'atakoy', 'pendik', flat(360, 1250), 'Marmaray · Ataköy – Pendik')
  // Zeytinburnu ⇄ Pendik, 20:50–22:40 — the after-20:50 Pendik short-turn ending at Zeytinburnu
  // ("Zeytinburnu treni" = Pendik→Zeytinburnu). Last Pendik departure ~22:39 (official).
  sub('B1Z', 'zeytinburnu-fisekhane', 'pendik', flat(1250, 1360), 'Marmaray · Pendik – Zeytinburnu')
})()

// ---------------------------------------------------------------------------
// 6) under-construction overlay (İBB GeoJSON, geometry only)
// ---------------------------------------------------------------------------
function stitchFrags(frags, tol = 90) {
  if (!frags.length) return []
  const used = new Array(frags.length).fill(false)
  let line = frags[0].slice()
  used[0] = true
  for (let pass = 0; pass < 2; pass++) {
    let ext = true
    while (ext) {
      ext = false
      const tail = line[line.length - 1]
      let best = -1
      let rev = false
      let bd = Infinity
      for (let i = 0; i < frags.length; i++) {
        if (used[i]) continue
        const f = frags[i]
        const ds = hav(tail, f[0])
        const de = hav(tail, f[f.length - 1])
        if (ds < bd) { bd = ds; best = i; rev = false }
        if (de < bd) { bd = de; best = i; rev = true }
      }
      if (best >= 0 && bd < tol) {
        const f = rev ? frags[best].slice().reverse() : frags[best]
        used[best] = true
        line.push(...f.slice(1))
        ext = true
      }
    }
    line.reverse()
  }
  return line
}
const construction = []
const conGroups = new Map()
for (const f of geo.features) {
  if (f.properties?.PROJE_ASAMA !== 'İnşaat Aşamasında') continue
  const name = (f.properties.PROJE_AD_KISA || f.properties.PROJE_ADI || '').trim()
  const codeM = /^((M|T|F|TF)\d+[A-Z]?)/.exec(name)
  const key = codeM ? codeM[1] : name.slice(0, 16)
  if (!conGroups.has(key)) conGroups.set(key, { key, name, frags: [] })
  const g = f.geometry
  if (g?.type === 'LineString') conGroups.get(key).frags.push(g.coordinates)
  else if (g?.type === 'MultiLineString') for (const p of g.coordinates) conGroups.get(key).frags.push(p)
}
for (const g of conGroups.values()) {
  const line = stitchFrags(g.frags.filter((p) => p && p.length >= 2))
  if (line.length >= 2) {
    construction.push({
      code: g.key,
      name: g.name,
      geometry: line.map((p) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))]),
    })
  }
}

// ---------------------------------------------------------------------------
// emit
// ---------------------------------------------------------------------------
const network = {
  meta: {
    version: '0.2.0',
    generatedAt: new Date().toISOString(),
    sources: [
      'OpenStreetMap route relations (geometry + station order)',
      'Metro İstanbul Mobile API V2 (colors, schedules, accessibility)',
      'İBB Açık Veri (under-construction geometry)',
    ],
  },
  lines,
  stations,
  segments,
  schedules,
  profiles,
  construction,
  transfers,
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(network))

console.table(
  report.reduce((acc, r) => {
    acc[r.code] = { stations: r.st, sliced: r.sliced, chord: r.chord, geom: r.geom }
    return acc
  }, {}),
)
console.log(
  `Lines: ${Object.keys(lines).length} | Stations: ${Object.keys(stations).length} | Transfers: ${Object.values(stations).filter((s) => s.isTransfer).length} | Construction: ${construction.length}`,
)
console.log('Lengths:', Object.keys(lines).map((c) => `${c} ${(profiles[c].totalLengthM / 1000).toFixed(1)}km`).join(' · '))
console.log(`Output: ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`)
