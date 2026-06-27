// Screenshot the running app for visual QA.
//   node scripts/dev/shot.mjs <outDir> [url]
import { chromium } from 'playwright'

const OUT = process.argv[2]
const URL = process.argv[3] || 'http://localhost:5180/'
const browser = await chromium.launch()

async function load(opts) {
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
  return { ctx, page, errors }
}

// warm up tiles/cache so the first real shot isn't blank
{
  const { ctx, page } = await load({ viewport: { width: 1366, height: 850 }, colorScheme: 'light' })
  await page.waitForTimeout(9000)
  await ctx.close()
}

async function shot(name, opts, actions) {
  const { ctx, page, errors } = await load(opts)
  await page.waitForTimeout(opts.colorScheme === 'dark' ? 5500 : 5500)
  if (actions) {
    await actions(page)
    await page.waitForTimeout(2500)
  }
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`${name}: errors=${errors.length}`)
  errors.slice(0, 6).forEach((e) => console.log('   ! ' + e))
  await ctx.close()
}

await shot('p-desktop-light', { viewport: { width: 1366, height: 850 }, colorScheme: 'light' })
await shot('p-desktop-dark', { viewport: { width: 1366, height: 850 }, colorScheme: 'dark' })
await shot('p-desktop-line', { viewport: { width: 1366, height: 850 }, colorScheme: 'light' }, async (page) => {
  await page.locator('.row').first().click().catch(() => {})
})
await shot('p-mobile-home', { viewport: { width: 390, height: 844 }, colorScheme: 'light' }, async (page) => {
  await page.locator('.panel__handle').click().catch(() => {})
})
await shot('p-mobile-station', { viewport: { width: 390, height: 844 }, colorScheme: 'dark' }, async (page) => {
  await page.locator('.panel__handle').click().catch(() => {})
  await page.locator('.row').filter({ hasText: /./ }).nth(0).click().catch(() => {})
})
await browser.close()
console.log('done')
