// Fetch Istanbul rail + Metrobüs route relations from OpenStreetMap (Overpass),
// with ordered members + geometry. → data/raw/osm.json
//   node scripts/data/fetch-osm.mjs
import fs from 'node:fs'
import path from 'node:path'

const RAW = path.resolve(import.meta.dirname, '../../data/raw')
fs.mkdirSync(RAW, { recursive: true })

const BBOX = '40.75,28.25,41.55,29.95' // S,W,N,E — greater Istanbul incl. Gebze
const QUERY = `[out:json][timeout:600];
(
  relation["type"="route"]["route"~"^(subway|light_rail|tram|funicular|train|monorail)$"](${BBOX});
  relation["type"="route"]["route"="bus"]["ref"~"^34"](${BBOX});
)->.r;
.r out geom;
node(r.r);
out;`

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

let data = null
for (const url of ENDPOINTS) {
  try {
    process.stdout.write(`Querying ${url} … `)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(QUERY),
    })
    if (!res.ok) {
      console.log(`HTTP ${res.status}`)
      continue
    }
    data = await res.json()
    console.log(`ok — ${data.elements?.length ?? 0} relations`)
    break
  } catch (e) {
    console.log(`failed: ${e.message}`)
  }
}

if (!data) {
  console.error('All Overpass endpoints failed.')
  process.exit(1)
}

fs.writeFileSync(path.join(RAW, 'osm.json'), JSON.stringify(data))
console.log(`Saved ${(fs.statSync(path.join(RAW, 'osm.json')).size / 1024 / 1024).toFixed(1)} MB to data/raw/osm.json`)

// quick inventory
const rels = data.elements.filter((e) => e.type === 'relation')
const rows = rels
  .map((r) => ({
    id: r.id,
    route: r.tags?.route,
    ref: r.tags?.ref || '',
    network: r.tags?.network || '',
    name: r.tags?.name || '',
    colour: r.tags?.colour || r.tags?.color || '',
    members: r.members?.length || 0,
    stops: r.members?.filter((m) => /stop|platform/.test(m.role || '')).length || 0,
  }))
  .sort((a, b) => (a.ref || 'zz').localeCompare(b.ref || 'zz'))
console.log(`\n${rows.length} relations:`)
for (const r of rows)
  console.log(
    `  ${String(r.ref).padEnd(8)} ${String(r.route).padEnd(11)} ${r.colour.padEnd(8)} stops=${String(r.stops).padStart(3)} | ${r.name.slice(0, 50)} [${r.network}]`,
  )
