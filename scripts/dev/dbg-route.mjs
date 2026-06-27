import { chromium } from 'playwright'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERR', e.message))
await page.goto('http://localhost:5180/', { waitUntil: 'networkidle' }).catch(() => {})
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
await page.waitForTimeout(1200)
const info = await page.evaluate(() => {
  const m = window.__map
  if (!m) return { noMap: true }
  const st = window.__store && window.__store.getState()
  const plan = st && st.journeyPlan
  return {
    styleLoaded: m.isStyleLoaded(),
    storePlanLegs: plan ? plan.legs.length : 'NULL',
    storeView: st && st.view,
    journeyVis: m.getLayer('mli-journey') ? m.getLayoutProperty('mli-journey', 'visibility') : null,
    linesOpacity: m.getPaintProperty('mli-lines', 'line-opacity'),
    zoom: m.getZoom().toFixed(2),
  }
})
console.log(JSON.stringify(info, null, 2))
await browser.close()
