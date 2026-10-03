// Screenshots of the running app for review: node scripts/shot.mjs <path> [name] [width] [waitMs] [actions-js]
import { chromium } from 'playwright-core'

const [path = '/', name = 'shot', width = '1280', wait = '2500', actions = ''] = process.argv.slice(2)
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage({ viewport: { width: Number(width), height: 900 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.goto('http://localhost:5180/#' + path, { waitUntil: 'load' })
if (actions) await new Function('page', `return (async () => { ${actions} })()`)(page)
await page.waitForTimeout(Number(wait))
// Scroll through so lazy images load before the full-page capture.
const height = await page.evaluate(() => document.body.scrollHeight)
for (let y = 0; y < height; y += 700) {
  await page.evaluate((top) => window.scrollTo(0, top), y)
  await page.waitForTimeout(150)
}
await page.evaluate(() => window.scrollTo(0, 0))
await page.waitForTimeout(800)
await page.screenshot({ path: `.shots/${name}.png`, fullPage: true })
console.log(`.shots/${name}.png`, errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no errors')
await browser.close()
