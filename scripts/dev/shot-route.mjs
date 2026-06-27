import { chromium } from 'playwright'
const OUT = process.argv[2]
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 }, deviceScaleFactor: 2, colorScheme: 'light' })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message))
await page.goto('http://localhost:5180/', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(6000)
await page.locator('.quick-action--primary').click()
await page.waitForTimeout(400)
async function pick(idx, text) {
  await page.locator('.picker__chip').nth(idx).click()
  await page.waitForTimeout(300)
  await page.locator('.picker__input').fill(text)
  await page.waitForTimeout(600)
  await page.locator('.picker__result').first().click()
  await page.waitForTimeout(400)
}
await pick(0, 'Kadıköy')
await pick(1, 'Mecidiyeköy')
await page.waitForTimeout(1800)
await page.screenshot({ path: `${OUT}/route-highlight.png` })
console.log('errors=', errors.length)
errors.slice(0, 6).forEach((e) => console.log('  ! ' + e))
await browser.close()
console.log('done')
