// Typing-latency probe for the editor regression hunt (not part of the app or
// the test suite). Drives a running `vite` dev server with Playwright and
// measures, per keystroke, keydown → next frame + task (rAF then setTimeout).
//
//   node scripts/perf/typing-bench.mjs <baseUrl> <scenario> <browser> <label>
//
// Scenarios: `note` (small demo graph, the pinned "Kore V2" note, which has the
// properties row under its title) and `large-daily` (`?seed=large`, typing in
// today's 400-block daily note). Prints one JSON line per run.
import { chromium, webkit } from 'playwright'

const [, , base, scenario = 'note', browserName = 'webkit', label = ''] = process.argv
const keys = 'the quick brown fox jumps over the lazy dog and keeps on typing '.repeat(2)
const browserType = browserName === 'chromium' ? chromium : webkit

const browser = await browserType.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', (error) => console.error('pageerror', error.message))
const large = scenario.startsWith('large')
await page.goto(large ? `${base}/?seed=large` : `${base}/`)
await page.waitForSelector('.ProseMirror', { timeout: 300_000 })
await page.waitForTimeout(large ? 20_000 : 5_000)
if (scenario === 'note') {
  await page.getByText('Kore V2', { exact: true }).first().click()
  await page.waitForTimeout(3_000)
  await page.getByText('The offline-first rewrite', { exact: false }).first().click()
} else {
  await page.locator('.ProseMirror p').first().click()
}
await page.keyboard.press('End')
await page.waitForTimeout(1_000)
await page.evaluate(() => {
  window.__lat = []
  window.addEventListener(
    'keydown',
    () => {
      const t0 = performance.now()
      requestAnimationFrame(() => setTimeout(() => window.__lat.push(performance.now() - t0), 0))
    },
    true,
  )
})
for (const key of keys) {
  await page.keyboard.type(key)
  await page.waitForTimeout(80)
}
await page.waitForTimeout(2_000)
const landed = await page.evaluate(() => document.body.innerText.includes('lazy dog and keeps on'))
const all = await page.evaluate(() => window.__lat)
const lat = all.slice(5).sort((a, b) => a - b)
const q = (f) => Number(lat[Math.min(lat.length - 1, Math.floor(f * lat.length))].toFixed(1))
console.log(
  JSON.stringify({ label, scenario, browser: browserName, landed, n: lat.length, p50: q(0.5), p90: q(0.9), max: q(0.999) }),
)
await browser.close()
