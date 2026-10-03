// Screenshots while a session is being curated: node scripts/shot-progress.mjs <personId> <name> [times-ms...]
import { chromium } from 'playwright-core'

const [id = 'ex-rosa', name = 'progress', ...times] = process.argv.slice(2)
const at = (times.length ? times : ['4000', '14000', '40000']).map(Number)
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const t0 = Date.now()
await page.goto(`${process.env.BASE ?? 'http://localhost:5180'}/#/plan/${id}`, { waitUntil: 'load' })
for (const [i, ms] of at.entries()) {
  await page.waitForTimeout(Math.max(0, ms - (Date.now() - t0)))
  await page.screenshot({ path: `.shots/${name}-${i + 1}.png` })
  console.log(`.shots/${name}-${i + 1}.png at ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}
console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no errors')
await browser.close()
