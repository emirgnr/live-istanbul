// Targeted map QA: jump to specific [lng,lat,zoom] spots and screenshot.
//   node scripts/dev/shot-loc.mjs <outDir> [url]
import { chromium } from 'playwright'

const OUT = process.argv[2]
const URL = process.argv[3] || 'http://localhost:5180/'

const SPOTS = [
  { name: 'sirkeci', center: [28.9773, 41.0143], zoom: 15.5 },
  { name: 'halkali', center: [28.7663, 41.0191], zoom: 15 },
  { name: 'yenikapi', center: [28.9516, 41.0051], zoom: 15 },
  { name: 'metrobus-sefakoy', center: [28.82, 40.995], zoom: 13.2 },
  { name: 'otogar-m1', center: [28.894, 41.04], zoom: 14 },
]

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1200, height: 800 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
})
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message))
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(8000)

for (const s of SPOTS) {
  await page.evaluate(({ center, zoom }) => {
    // eslint-disable-next-line
    window.__map?.jumpTo({ center, zoom })
  }, s)
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/${s.name}.png` })
  console.log(`${s.name}: done`)
}
console.log('errors=', errors.length)
errors.slice(0, 8).forEach((e) => console.log('  ! ' + e))
await browser.close()
console.log('done')
