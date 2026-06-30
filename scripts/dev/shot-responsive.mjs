// Capture key scenarios at one viewport/theme for responsive QA.
//   node scripts/dev/shot-responsive.mjs <outDir> <W> <H> <theme>
// Produces <outDir>/{home,search,journey,line,station,about}.png
import { chromium } from 'playwright'
import fs from 'node:fs'

const [outDir, W, H, theme = 'light'] = process.argv.slice(2)
const width = parseInt(W, 10)
const height = parseInt(H, 10)
const mobile = width < 880
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()

async function fresh() {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: theme === 'dark' ? 'dark' : 'light',
    isMobile: mobile,
    hasTouch: mobile,
  })
  const page = await ctx.newPage()
  await page.goto('http://localhost:5180/', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {})
  await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(4500)
  return { ctx, page }
}
async function expand(page) {
  if (!mobile) return
  const h = page.locator('.mi-sheet__handle')
  if (await h.count()) await h.click().catch(() => {})
  await page.waitForTimeout(450)
}
async function shot(page, name) {
  await page.screenshot({ path: `${outDir}/${name}.png` })
}
async function pick(page, idx, text) {
  await page.locator('.mi-pick__chip').nth(idx).click()
  await page.waitForTimeout(250)
  await page.locator('.mi-pick__input').fill(text)
  await page.waitForTimeout(550)
  await page.locator('.mi-pick__result').first().click().catch(() => {})
  await page.waitForTimeout(300)
}

// home (panel expanded)
try {
  const { ctx, page } = await fresh()
  await expand(page)
  await shot(page, 'home')
  // search
  await page.locator('.mi-search__input').fill('ka').catch(() => {})
  await page.waitForTimeout(500)
  await shot(page, 'search')
  await ctx.close()
} catch (e) {
  console.log('home/search ERR', e.message)
}

// journey with a computed route
try {
  const { ctx, page } = await fresh()
  await expand(page)
  await page.locator('.mi-btn--primary').click()
  await page.waitForTimeout(350)
  await pick(page, 0, 'Kadıköy')
  await pick(page, 1, 'Mecidiyeköy')
  await page.waitForTimeout(900)
  await shot(page, 'journey')
  await ctx.close()
} catch (e) {
  console.log('journey ERR', e.message)
}

// line detail + station detail (via a line's stop)
try {
  const { ctx, page } = await fresh()
  await expand(page)
  await page.locator('.mi-row').first().click() // first line
  await page.waitForTimeout(700)
  await shot(page, 'line')
  await page.locator('.mi-stops__btn').first().click().catch(() => {}) // a stop
  await page.waitForTimeout(700)
  await shot(page, 'station')
  await ctx.close()
} catch (e) {
  console.log('line/station ERR', e.message)
}

// about dialog
try {
  const { ctx, page } = await fresh()
  await page.locator('.mi-hdr__live').click()
  await page.waitForTimeout(700)
  await shot(page, 'about')
  await ctx.close()
} catch (e) {
  console.log('about ERR', e.message)
}

await browser.close()
console.log('done', `${width}x${height} ${theme}`)
