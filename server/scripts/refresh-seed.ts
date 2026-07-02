/**
 * refresh-seed.ts — Canlı SeferDetaylari'ndan hat/durak/yön eşleştirmesini çekip
 * server/data/stations.seed.json'a yazar (çevrimdışı/soğuk-başlangıç fallback'i).
 *   npm run seed:refresh
 */

import fs from 'node:fs'
import path from 'node:path'
import * as metroClient from '../metroClient'
import { parseMapping, parseKod } from '../mappingParser'

const OUT = path.join(import.meta.dirname, '..', 'data', 'stations.seed.json')

async function main() {
  console.log('SeferDetaylari çekiliyor…')
  const { html } = await metroClient.fetchSeferPage()
  const kod = parseKod(html)
  const mapping = parseMapping(html)

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'https://www.metro.istanbul/SeferDurumlari/SeferDetaylari',
    note: 'Otomatik üretildi (refresh-seed.ts). kod yalnızca referans; çalışma anında canlı kazınır.',
    kodAtGeneration: kod,
    lineCount: mapping.lineCount,
    lines: mapping.lines,
  }

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8')
  console.log(`Yazıldı: ${OUT}`)
  console.log(`  ${mapping.lineCount} hat, kod=${kod}`)
  for (const l of mapping.lines) {
    console.log(`  ${l.code.padEnd(9)} ${l.stations.length} durak, ${l.routes.length} yön`)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error('Seed güncelleme başarısız:', (e as Error).message)
  process.exit(1)
})
