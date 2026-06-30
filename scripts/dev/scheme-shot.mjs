// Screenshot the SCHEME mode of the running app for visual QA.
//   node scheme-shot.mjs <outDir> [url]
import { chromium } from 'playwright'

const OUT = process.argv[2]
const URL = process.argv[3] || 'http://localhost:5174/'
const browser = await chromium.launch()

async function newPage(viewport, colorScheme) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERR ' + e.message))
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
  return { ctx, page, errors }
}

async function toScheme(page) {
  // click the mode-toggle button (shows "Şema" while in geo mode)
  await page.getByRole('button', { name: 'Şema' }).click().catch(async () => {
    await page.locator('.app-header__actions button').first().click().catch(() => {})
  })
  await page.waitForSelector('.scheme', { timeout: 15000 }).catch(() => {})
  await page.waitForSelector('.scard', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1200)
}

async function snap(page, name, errors) {
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`${name}: errors=${errors.length}`)
  errors.slice(0, 8).forEach((e) => console.log('   ! ' + e))
}

async function setRoute(page, fromQ, toQ) {
  // open planner
  await page.locator('.shome__plan').click().catch(() => {})
  await page.waitForTimeout(500)
  const inputs = page.locator('.rplan .sfield__input')
  await inputs.nth(0).fill(fromQ).catch(() => {})
  await page.waitForTimeout(700)
  await page.locator('.rfield__res li button').first().click().catch(() => {})
  await page.waitForTimeout(400)
  // second field is now the first remaining input
  await page.locator('.rplan .sfield__input').first().fill(toQ).catch(() => {})
  await page.waitForTimeout(700)
  await page.locator('.rfield__res li button').first().click().catch(() => {})
  await page.waitForTimeout(900)
}

// ---- desktop home (line list) ----
{
  const { ctx, page, errors } = await newPage({ width: 1440, height: 900 }, 'light')
  await toScheme(page)
  await snap(page, 'd-home', errors)
  await ctx.close()
}
// ---- desktop line card → station → deeper transfer (back/home nav) ----
{
  const { ctx, page, errors } = await newPage({ width: 1440, height: 900 }, 'light')
  await toScheme(page)
  await page.locator('.srow').first().click().catch(() => {})
  await page.waitForTimeout(900)
  await snap(page, 'd-line', errors)
  // ---- station card (from line stop) ----
  await page.locator('.sstops li button').nth(2).click().catch(() => {})
  await page.waitForTimeout(900)
  await snap(page, 'd-station', errors)
  // ---- one level deeper via a transfer → nav shows BACK + HOME ----
  await page.locator('.sxfer').first().click().catch(() => {})
  await page.waitForTimeout(900)
  await snap(page, 'd-station-deep', errors)
  await ctx.close()
}
// ---- desktop route planner (empty + with options) ----
{
  const { ctx, page, errors } = await newPage({ width: 1440, height: 900 }, 'light')
  await toScheme(page)
  await page.locator('.shome__plan').click().catch(() => {})
  await page.waitForTimeout(600)
  await snap(page, 'd-route-empty', errors)
  await ctx.close()
}
{
  const { ctx, page, errors } = await newPage({ width: 1440, height: 900 }, 'light')
  await toScheme(page)
  await setRoute(page, 'Kadıköy', 'Hacıosman')
  await snap(page, 'd-route-full', errors)
  // expand a leg's stops
  await page.locator('.rleg__more').first().click().catch(() => {})
  await page.waitForTimeout(500)
  await snap(page, 'd-route-expanded', errors)
  await ctx.close()
}
// ---- header in scheme mode while STORED theme is dark ----
{
  const { ctx, page, errors } = await newPage({ width: 1440, height: 900 }, 'dark')
  // force dark theme persisted, then reload into scheme
  await page.evaluate(() => {
    localStorage.setItem('mli-ui', JSON.stringify({ state: { theme: 'dark', lang: 'tr', mapMode: 'scheme' }, version: 0 }))
  })
  await page.reload({ waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForSelector('.scheme', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1200)
  await snap(page, 'd-home-darkstore', errors)
  await ctx.close()
}
// ---- tablet ----
{
  const { ctx, page, errors } = await newPage({ width: 834, height: 1112 }, 'light')
  await toScheme(page)
  await snap(page, 't-home', errors)
  await ctx.close()
}
// ---- mobile home + route ----
{
  const { ctx, page, errors } = await newPage({ width: 390, height: 844 }, 'light')
  await toScheme(page)
  await snap(page, 'm-home', errors)
  await ctx.close()
}
{
  const { ctx, page, errors } = await newPage({ width: 390, height: 844 }, 'light')
  await toScheme(page)
  await setRoute(page, 'Kadıköy', 'Hacıosman')
  await snap(page, 'm-route-full', errors)
  await ctx.close()
}

await browser.close()
console.log('done')
