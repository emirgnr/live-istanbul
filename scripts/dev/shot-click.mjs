// One-off: center on the M1 trunk, click it, screenshot the line-choice popup.
import { chromium } from 'playwright'
const OUT = process.argv[2]
const URL = 'http://localhost:5180/'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2, colorScheme: 'light' })
const page = await ctx.newPage()
await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(8000)
// center on a trunk vertex so the line passes through canvas center
await page.evaluate(() => window.__map?.jumpTo({ center: [28.949661, 41.01088], zoom: 14.5 }))
await page.waitForTimeout(2500)
await page.screenshot({ path: `${OUT}/m1-trunk-before.png` })
// click canvas center (the line)
const box = await page.locator('.maplibregl-canvas').boundingBox()
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/m1-trunk-popup.png` })
console.log('done')
await browser.close()
