/**
 * Build the PER-LINE geo dataset for the map layer, from the İBB-verified network data.
 *
 *   node scripts/data/build-geo.mjs        # → src/data/geo.generated.json
 *
 * Why this exists: the base dataset MERGES a station shared by several lines into one dot
 * (e.g. one "Ataköy" for M9 + Marmaray). The map must instead show each line's own stop as
 * a SEPARATE point. This script un-merges into per-line entities:
 *   line    = { line_id, line_name, color, off, geometry:[[lon,lat]…] }
 *   station = { station_id:"<line>:<slug>", station_name, line_id, coordinates, order, ref_id, terminus }
 *   transfer= { a, b, dist_m }   // metadata only — NEVER drawn on the geo map
 * Co-located stops of different lines are spread perpendicular to the main track so they read
 * as distinct platforms (the base data snapped every line to converge on the merged dot, so a
 * plain per-line projection would still overlap). `ref_id` bridges a map click back to the base
 * station record so the panel / live arrivals / journey planner keep working unchanged.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const net = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/network.generated.json'), 'utf8'))

const slug = (s) =>
  (s || '').toLocaleLowerCase('tr')
    .replaceAll('ı', 'i').replaceAll('İ', 'i').replaceAll('ğ', 'g')
    .replaceAll('ü', 'u').replaceAll('ş', 's').replaceAll('ö', 'o').replaceAll('ç', 'c')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const R = 6371000
const rad = (d) => (d * Math.PI) / 180
const hav = (a, b) => {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
// local equirectangular metres frame at a reference latitude
const mPerLon = (lat) => (Math.PI / 180) * R * Math.cos(rad(lat))
const mPerLat = (Math.PI / 180) * R

function polylineFor(lid) {
  const segs = net.segments[lid]
  if (!segs?.length) return []
  const c = [segs[0].geometry[0]]
  for (const s of segs) for (let i = 1; i < s.geometry.length; i++) c.push(s.geometry[i])
  return c
}
function polyLenM(poly) {
  let s = 0
  for (let i = 0; i < poly.length - 1; i++) s += hav(poly[i], poly[i + 1])
  return s
}
// nearest point on a polyline to p, plus the local unit tangent there (in [lon,lat]-ish frame)
function nearestOnPoly(p, poly) {
  const lat0 = p[1], kx = mPerLon(lat0)
  let best = { d: Infinity, coord: p, tan: [1, 0] }
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1]
    const ax = a[0] * kx, ay = a[1] * mPerLat, bx = b[0] * kx, by = b[1] * mPerLat
    const px = p[0] * kx, py = p[1] * mPerLat
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
    t = Math.max(0, Math.min(1, t))
    const cx = ax + t * dx, cy = ay + t * dy
    const d = Math.hypot(px - cx, py - cy)
    if (d < best.d) {
      const len = Math.hypot(dx, dy) || 1
      best = { d, coord: [(cx / kx), cy / mPerLat], tan: [dx / len, dy / len] }
    }
  }
  return best
}

// ---- shared-corridor offsets (same logic as the map's lineOffsets), for the LINE ribbons ----
const NEAR_M = 25, BUNDLE_M = 1000
function densify(poly, step = 50) {
  if (poly.length < 2) return poly
  const out = []
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1], num = Math.max(1, Math.ceil(hav(a, b) / step))
    for (let j = 0; j < num; j++) out.push([a[0] + ((b[0] - a[0]) * j) / num, a[1] + ((b[1] - a[1]) * j) / num])
  }
  out.push(poly[poly.length - 1])
  return out
}
function pointPolyM(p, poly) {
  let m = Infinity
  for (let i = 0; i < poly.length - 1; i++) { const d = nearestOnPolySeg(p, poly[i], poly[i + 1]); if (d < m) m = d; if (m < 1) break }
  return m
}
function nearestOnPolySeg(p, a, b) {
  const kx = mPerLon(p[1])
  const ax = a[0] * kx, ay = a[1] * mPerLat, bx = b[0] * kx, by = b[1] * mPerLat, px = p[0] * kx, py = p[1] * mPerLat
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
function computeOffsets(ids, poly) {
  const dense = {}, len = {}
  for (const id of ids) { dense[id] = densify(poly[id]); len[id] = polyLenM(poly[id]) }
  const parent = {}
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  for (const id of ids) parent[id] = id
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const A = ids[i], B = ids[j]
      const nA = dense[A].reduce((n, p) => n + (pointPolyM(p, poly[B]) < NEAR_M ? 1 : 0), 0)
      const nB = dense[B].reduce((n, p) => n + (pointPolyM(p, poly[A]) < NEAR_M ? 1 : 0), 0)
      if (Math.max((nA / dense[A].length) * len[A], (nB / dense[B].length) * len[B]) > BUNDLE_M)
        parent[find(A)] = find(B)
    }
  const groups = {}
  for (const id of ids) (groups[find(id)] ||= []).push(id)
  const off = {}
  for (const m of Object.values(groups)) {
    if (m.length < 2) { off[m[0]] = 0; continue }
    m.sort()
    const mid = (m.length - 1) / 2
    m.forEach((id, i) => (off[id] = i - mid))
  }
  return off
}

// ---------------------------------------------------------------------------
const rendered = Object.values(net.lines).filter((l) => !l.hidden)
const ids = rendered.map((l) => l.id).filter((id) => polylineFor(id).length >= 2)
const poly = Object.fromEntries(ids.map((id) => [id, polylineFor(id)]))
const offsets = computeOffsets(ids, poly)

const lines = rendered.map((l) => ({
  line_id: l.id,
  line_name: l.name.tr,
  color: l.color,
  off: offsets[l.id] ?? 0,
  geometry: poly[l.id] ?? polylineFor(l.id),
}))

// ---- İBB per-line station POI: authoritative REAL platform coordinates ----
// The base data snapped every line's stop onto one merged dot, so co-located stops of
// different lines coincide. İBB's `rayli_sistem_istasyon_poi_verisi` has a SEPARATE point
// per line (e.g. M9-Ataköy ≈34 m from Marmaray-Ataköy). We use those real coords so shared
// stations separate authentically, falling back to a perpendicular spread only where İBB
// lacks a per-line point for every line of a station (never mix real + synthetic at one stop).
const norm = (s) =>
  (s || '').toLocaleUpperCase('tr').replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C').replace(/[^A-Z0-9]/g, '')
const codesByLen = rendered.map((l) => l.id).sort((a, b) => b.length - a.length)
function poiLineId(projeAdi) {
  const s = (projeAdi || '').trim()
  if (/Marmaray/i.test(s)) return 'B1'
  if (/Kazlıçeşme/i.test(s) || s.startsWith('Sirkeci - Kazl')) return 'T6'
  for (const code of codesByLen) {
    if (s.startsWith(code)) { const c = s[code.length]; if (c === undefined || ' (-'.includes(c)) return code }
  }
  return null
}
const poiIndex = {} // `${lineId}|${normName}` → [lon,lat]
try {
  const poiRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/raw/stations_poi.geojson'), 'utf8'))
  for (const f of poiRaw.features) {
    const lid = poiLineId(f.properties?.PROJE_ADI)
    if (!lid || f.geometry?.type !== 'Point') continue
    const key = `${lid}|${norm(f.properties?.ISTASYON)}`
    if (!poiIndex[key]) poiIndex[key] = f.geometry.coordinates
  }
} catch { /* no raw POI available → spread fallback everywhere */ }

// perpendicular platform spread (fallback when İBB has no per-line point for a shared stop).
const SPREAD_M = 26
const stations = []
const seen = new Set()
for (const l of rendered) {
  const lineStations = net.lines[l.id]?.stations ?? []
  lineStations.forEach((sid, idx) => {
    const st = net.stations[sid]
    if (!st) return
    let coord = st.coord
    const lineList = st.lines
    if (lineList.length > 1 && lineList.includes(l.id) && poly[l.id]?.length >= 2) {
      const nm = norm(st.name.tr)
      const poiForAll = lineList.every((li) => poiIndex[`${li}|${nm}`])
      if (poiForAll) {
        // authoritative İBB per-line platform coordinate
        coord = poiIndex[`${l.id}|${nm}`]
      } else {
        // synthetic spread perpendicular to the PRIMARY line's track at the station
        const primary = poly[lineList[0]]?.length >= 2 ? lineList[0] : l.id
        const near = nearestOnPoly(st.coord, poly[primary])
        const perp = [-near.tan[1], near.tan[0]]
        const rank = lineList.indexOf(l.id) - (lineList.length - 1) / 2
        const dm = rank * SPREAD_M
        const kx = mPerLon(st.coord[1])
        coord = [st.coord[0] + (perp[0] * dm) / kx, st.coord[1] + (perp[1] * dm) / mPerLat]
      }
    }
    coord = coord || st.coord
    stations.push({
      station_id: `${l.id}:${slug(st.name.tr)}`,
      station_name: st.name.tr,
      line_id: l.id,
      coordinates: [Number(coord[0].toFixed(6)), Number(coord[1].toFixed(6))],
      order: idx,
      ref_id: sid,
      terminus: idx === 0 || idx === lineStations.length - 1 ? 1 : 0,
    })
    seen.add(sid)
  })
}

// transfers: metadata only (never drawn). Link per-line entities of DIFFERENT lines whose base
// records are the same merged station or sit within walking distance.
const TRANSFER_M = 250
const byRef = {}
for (const s of stations) (byRef[s.ref_id] ||= []).push(s)
const transfers = []
const pushed = new Set()
// (a) same base record shared across lines = same-station interchange
for (const [, group] of Object.entries(byRef)) {
  for (let i = 0; i < group.length; i++)
    for (let j = i + 1; j < group.length; j++) {
      const key = [group[i].station_id, group[j].station_id].sort().join('|')
      if (pushed.has(key)) continue
      pushed.add(key)
      transfers.push({ a: group[i].station_id, b: group[j].station_id, dist_m: 0 })
    }
}
// (b) walking interchange between distinct nearby base records (from the base transfers list)
for (const t of net.transfers ?? []) {
  const A = byRef[t.a] ?? [], B = byRef[t.b] ?? []
  const d = net.stations[t.a] && net.stations[t.b] ? Math.round(hav(net.stations[t.a].coord, net.stations[t.b].coord)) : TRANSFER_M
  for (const a of A) for (const b of B) {
    if (a.line_id === b.line_id) continue
    const key = [a.station_id, b.station_id].sort().join('|')
    if (pushed.has(key)) continue
    pushed.add(key)
    transfers.push({ a: a.station_id, b: b.station_id, dist_m: d })
  }
}

const out = {
  meta: {
    generatedFrom: 'network.generated.json (İBB-verified) — per-line un-merge',
    lines: lines.length,
    stations: stations.length,
    transfers: transfers.length,
  },
  lines,
  stations,
  transfers,
}
fs.writeFileSync(path.join(ROOT, 'src/data/geo.generated.json'), JSON.stringify(out))
console.log(`geo.generated.json: ${lines.length} lines, ${stations.length} per-line stations, ${transfers.length} transfer links`)
// quick separation check on the owner's examples
for (const ref of ['atakoy', 'halkali', 'ayrilik-cesmesi', 'yenikapi', 'uskudar']) {
  const g = byRef[ref] || []
  if (g.length < 2) continue
  let maxd = 0
  for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) maxd = Math.max(maxd, hav(g[i].coordinates, g[j].coordinates))
  console.log(`  ${ref}: ${g.length} per-line dots [${g.map((s) => s.line_id).join(',')}] maxSep=${Math.round(maxd)}m`)
}
