// Screenshot the running app (preview server) for visual QA.
//   node scripts/dev/shot.mjs <outDir> [url]
import { chromium } from 'playwright'

const OUT = process.argv[2]
const URL = process.argv[3] || 'http://localhost:4173/'
const browser = await chromium.launch()

async function shot(name, opts, actions) {
  const ctx = await browser.newContext({
    viewport: opts.viewport,
    deviceScaleFactor: 2,
    colorScheme: opts.colorScheme,
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message))
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
  await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 }).catch(() => {})
  if (actions) await actions(page)
  await page.waitForTimeout(7000)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`${name}: errors=${errors.length}`)
  errors.slice(0, 8).forEach((e) => console.log('   ! ' + e))
  await ctx.close()
}

await shot('desktop-light', { viewport: { width: 1366, height: 850 }, colorScheme: 'light' })
await shot('desktop-dark', { viewport: { width: 1366, height: 850 }, colorScheme: 'dark' })
await shot('mobile-light', { viewport: { width: 390, height: 844 }, colorScheme: 'light' })
await browser.close()
console.log('done')
