import { chromium } from 'playwright'
const OUT = process.argv[2]
const URL = 'http://localhost:5180/'
const browser = await chromium.launch()
for (const scheme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 750 }, deviceScaleFactor: 2, colorScheme: scheme })
  const page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
  await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(7000)
  await page.evaluate(() => window.__map?.jumpTo({ center: [28.987, 41.04], zoom: 13 }))
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${OUT}/bloom-${scheme}.png` })
  await ctx.close()
}
console.log('done')
await browser.close()
