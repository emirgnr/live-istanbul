// Download raw source data into data/raw/. Re-run to refresh.
//   node scripts/data/fetch.mjs
import fs from 'node:fs'
import path from 'node:path'
import { SOURCES } from './sources.mjs'

const RAW_DIR = path.resolve(import.meta.dirname, '../../data/raw')
fs.mkdirSync(RAW_DIR, { recursive: true })

const UA = 'Mozilla/5.0 (MetroLiveIstanbul data pipeline)'

async function download(name, { url, file }) {
  const dest = path.join(RAW_DIR, file)
  process.stdout.write(`• ${name} → ${file} … `)
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf)
  console.log(`${(buf.length / 1024).toFixed(0)} KB`)
}

const entries = Object.entries(SOURCES)
let ok = 0
for (const [name, src] of entries) {
  try {
    await download(name, src)
    ok++
  } catch (err) {
    console.log(`FAILED: ${err.message}`)
  }
}
console.log(`\nDone: ${ok}/${entries.length} sources fetched into ${RAW_DIR}`)
if (ok < entries.length) process.exitCode = 1
