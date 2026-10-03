// Viewport screenshots (3:2) of the live app for the Devpost gallery: node scripts/gallery.mjs [base-url]
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'https://encore.mikey9220.workers.dev'
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const shot = async (name, path, prepare) => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 })
  await page.goto(`${BASE}/#${path}`, { waitUntil: 'load' })
  await page.waitForTimeout(1500)
  if (prepare) await prepare(page)
  await page.screenshot({ path: `.shots/gallery-${name}.png` })
  console.log(`.shots/gallery-${name}.png`)
  await page.close()
}

await shot('home', '/')
await shot('rosa', '/s/ex-rosa-sample', async (page) => {
  await page.evaluate(() => document.querySelector('.moment')?.scrollIntoView({ block: 'start' }))
  await page.evaluate(() => window.scrollBy(0, -16))
  await page.waitForTimeout(800)
})
await shot('trace', '/s/ex-rosa-sample', async (page) => {
  await page.evaluate(() => {
    const d = document.getElementById('trace')
    if (d) d.open = true
  })
  await page.waitForTimeout(400)
  await page.evaluate(() => document.getElementById('trace')?.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(600)
})
// A live plan: the first plan, then moments turning "checked" as the curator finishes each one.
await shot('curating', '/plan/ex-dorothy', async (page) => {
  await page.waitForSelector('.checking.done', { timeout: 90_000 }).catch(() => undefined)
  await page.waitForTimeout(1500)
})
await browser.close()
