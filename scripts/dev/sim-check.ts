// Quick sanity check of the simulation engine: run `npx tsx scripts/dev/sim-check.ts`
import { simulate } from '@/lib/simulation/engine'
import { allLines, profileForLine } from '@/data'

function run(label: string, h: number, m: number) {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  const snap = simulate(d.getTime())
  console.log(`\n=== ${label} (${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}) — ${snap.trains.length} trains ===`)
  for (const l of allLines()) {
    const c = snap.countByLine[l.id] ?? 0
    const oneWay = profileForLine(l.id)?.oneWayTimeSec ?? 0
    if (c > 0) console.log(`  ${l.code.padEnd(5)} ${String(c).padStart(3)} trains  (one-way ${(oneWay / 60).toFixed(0)}dk)`)
  }
}

run('Peak', 8, 30)
run('Midday', 13, 0)
run('Late night', 2, 0)

// spot-check a couple of trains
const snap = simulate(new Date().setHours(8, 30, 0, 0))
console.log('\nSample trains:')
for (const t of snap.trains.slice(0, 4)) {
  console.log(`  ${t.id} | ${t.phase} | ${t.fromStation}→${t.toStation} | [${t.coord[0].toFixed(4)},${t.coord[1].toFixed(4)}] | eta ${t.etaNextSec.toFixed(0)}s`)
}
