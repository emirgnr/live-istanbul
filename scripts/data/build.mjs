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
  { code: 'M2', mode: 'metro', src: 'api', osmRef: 'M2', hint: 'Yenikapı - Hacıosman' },
  { code: 'M3', mode: 'metro', src: 'api', osmRef: 'M3', hint: 'Bakırköy Sahil' },
  { code: 'M4', mode: 'metro', src: 'api', osmRef: 'M4', hint: 'Kadıköy' },
  { code: 'M5', mode: 'metro', src: 'api', osmRef: 'M5', hint: 'Üsküdar' },
  { code: 'M6', mode: 'metro', src: 'api', osmRef: 'M6', hint: 'Levent' },
  { code: 'M7', mode: 'metro', src: 'api', osmRef: 'M7', hint: 'Mahmutbey - Mecidiyeköy' },
  { code: 'M8', mode: 'metro', src: 'api', osmRef: 'M8', hint: 'Bostancı - Parseller' },
  { code: 'M9', mode: 'metro', src: 'api', osmRef: 'M9', hint: 'Ataköy', color: '#FFD300' },
  { code: 'T1', mode: 'tram', src: 'api', osmRef: 'T1', hint: 'Kabataş - Bağcılar' },
  { code: 'T3', mode: 'tram', src: 'api', osmRef: 'T3' },
  { code: 'T4', mode: 'tram', src: 'api', osmRef: 'T4', hint: 'Topkapı' },
  { code: 'T5', mode: 'tram', src: 'api', osmRef: 'T5', hint: 'Eminönü' },
  { code: 'F1', mode: 'funicular', src: 'api', osmRef: 'F1' },
  { code: 'F4', mode: 'funicular', src: 'api', osmRef: 'F4' },
  { code: 'TF1', mode: 'cablecar', src: 'api' },
  { code: 'TF2', mode: 'cablecar', src: 'api' },
  // OSM-sourced lines (not in the Metro API)
  { code: 'M11', mode: 'metro', src: 'osm', osmRef: 'M11', hint: 'Gayrettepe → Halkalı', color: '#9B4E9C', first: '06:00', last: '00:40', peak: 360, night: true, name: 'Gayrettepe – İstanbul Havalimanı – Halkalı' },
  { code: 'B1', mode: 'marmaray', src: 'osm', osmRef: 'B1', hint: 'Halkalı - Gebze', color: '#009A93', first: '06:00', last: '00:00', peak: 480, night: true, name: 'Marmaray · Halkalı – Gebze', renames: { Gülhane: 'Sirkeci' } },
  { code: 'B2', mode: 'suburban', src: 'osm', osmRef: 'B2', hint: 'Halkalı - Bahçeşehir', color: '#77787C', first: '06:00', last: '23:00', peak: 1200, name: 'Halkalı – Bahçeşehir Banliyö' },
  { code: 'T2', mode: 'tram', src: 'osm', osmName: /Taksim - Tünel Nostaljik/, color: '#B12A2A', first: '07:00', last: '22:00', peak: 600, name: 'Taksim – Tünel Nostaljik Tramvay' },
  { code: 'T6', mode: 'tram', src: 'osm', osmRef: 'T6', hint: 'Sirkeci', color: '#E87D7D', first: '06:00', last: '00:00', peak: 600, name: 'Sirkeci – Kazlıçeşme' },
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
// 5) run-times, schedules, profiles
// ---------------------------------------------------------------------------
const CRUISE = { metro: 12.5, tram: 6.5, funicular: 4.5, cablecar: 5.0, marmaray: 16.0, suburban: 16.0, brt: 12.5 }
const ACCEL = 14
const MIN_RUN = 22
const DWELL = { metro: 25, tram: 20, funicular: 40, cablecar: 30, marmaray: 35, suburban: 40, brt: 20 }
const TERM = { metro: 240, tram: 180, funicular: 120, cablecar: 90, marmaray: 300, suburban: 300, brt: 120 }
const NIGHT = new Set(['M1A', 'M1B', 'M2', 'M4', 'M5', 'M6', 'M7', 'B1', 'M11', 'METROBUS'])
const PEAK = { M1A: 360, M1B: 240, M2: 235, M3: 360, M4: 300, M5: 300, M6: 300, M7: 240, M8: 360, M9: 360 }

const parseHM = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '')
  return m ? +m[1] * 60 + +m[2] : null
}

const schedules = {}
const profiles = {}
for (const code of Object.keys(lines)) {
  const L = lines[code]
  const mode = L.mode
  const peak = lineData.find((d) => d.cfg.code === code)?.cfg.peak ?? PEAK[code] ?? (mode === 'metro' ? 300 : mode === 'tram' ? 360 : 240)
  const base = Math.round(peak * 1.5)
  const evening = Math.round(peak * 2.2)

  let first = parseHM(L.firstTime)
  if (first == null || first < 240) first = 360
  let last = parseHM(L.lastTime)
  if (last == null) last = 1440
  if (last < 300) last += 1440

  const weekday = [
    { startMin: first, endMin: 420, headwaySec: base },
    { startMin: 420, endMin: 600, headwaySec: peak },
    { startMin: 600, endMin: 960, headwaySec: base },
    { startMin: 960, endMin: 1200, headwaySec: peak },
    { startMin: 1200, endMin: last, headwaySec: evening },
  ].filter((x) => x.endMin > x.startMin)
  const weekend = [
    { startMin: first, endMin: 600, headwaySec: base },
    { startMin: 600, endMin: 1200, headwaySec: Math.round((peak + base) / 2) },
    { startMin: 1200, endMin: last, headwaySec: evening },
  ].filter((x) => x.endMin > x.startMin)
  const nightBand = NIGHT.has(code) ? [{ startMin: 0, endMin: 330, headwaySec: 1800 }] : []

  schedules[code] = {
    lineId: code,
    firstDepartureMin: first,
    lastDepartureMin: last,
    bands: { weekday, saturday: [...nightBand, ...weekend], sunday: [...nightBand, ...weekend] },
    dwellSec: DWELL[mode],
    terminalLayoverSec: TERM[mode],
    nightService: NIGHT.has(code),
  }

  const dwell = DWELL[mode]
  const cruise = CRUISE[mode] || 11
  const cumD = [0]
  const cumT = [0]
  for (const seg of segments[code]) {
    const run = Math.max(MIN_RUN, Math.round(seg.lengthM / cruise + ACCEL))
    seg.runTimeS = run
    cumD.push(cumD[cumD.length - 1] + seg.lengthM)
    cumT.push(cumT[cumT.length - 1] + run + dwell)
  }
  profiles[code] = { lineId: code, cumDistanceM: cumD, totalLengthM: cumD[cumD.length - 1], cumTimeSec: cumT, oneWayTimeSec: cumT[cumT.length - 1] }
}

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
