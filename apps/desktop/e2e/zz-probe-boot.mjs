import { chromium } from 'playwright'
const out = process.argv[2]
const seed = process.argv[3] ?? 'obsidian'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const t0 = Date.now()
page.on('console', (msg) => {
  const text = msg.text()
  if (/index|dev-bridge|embed|rebuild|error/i.test(text)) console.log(`[${Date.now() - t0}ms] ${msg.type()}: ${text.slice(0, 300)}`)
})
page.on('pageerror', (err) => console.log('pageerror', err.message))
await page.addInitScript(() => {
  window.__long = []
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__long.push([Math.round(entry.startTime), Math.round(entry.duration)])
  }).observe({ type: 'longtask', buffered: true })
})
await page.goto(`http://127.0.0.1:5199/?seed=${seed}`)
await page.getByRole('navigation', { name: 'Primary' }).getByText('Daily notes').waitFor({ timeout: 120000 })
console.log(`[${Date.now() - t0}ms] nav visible`)
await page.waitForTimeout(45000)
const long = await page.evaluate(() => window.__long)
const total = long.reduce((sum, [, duration]) => sum + duration, 0)
const worst = [...long].sort((a, b) => b[1] - a[1]).slice(0, 10)
console.log(`longtasks=${long.length} total=${total}ms worst=${JSON.stringify(worst)}`)
const notes = await page.evaluate(() => window.__reflectDev.query('select count(*) as n from notes'))
console.log('notes', JSON.stringify(notes))
await page.screenshot({ path: `${out}/boot-${seed}.png` })
await browser.close()
