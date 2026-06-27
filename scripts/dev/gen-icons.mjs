// Render PWA icon PNGs from public/favicon.svg.  node scripts/dev/gen-icons.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const pub = path.resolve(import.meta.dirname, '../../public')
const svg = fs.readFileSync(path.join(pub, 'favicon.svg'), 'utf8')
const dataUri = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')

const browser = await chromium.launch()
async function gen(size, name) {
  const ctx = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.setContent(
    `<html><body style="margin:0;padding:0;background:#0b2545"><img src="${dataUri}" width="${size}" height="${size}" style="display:block"/></body></html>`,
  )
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(pub, name) })
  await ctx.close()
  console.log('wrote', name)
}
await gen(192, 'pwa-192.png')
await gen(512, 'pwa-512.png')
await gen(180, 'apple-touch-icon.png')
await browser.close()
console.log('icons done')
