// usage: node run.cjs <engine chromium|webkit> <seed query e.g. "seed=obsidian&scale=1"> <outprefix> [throttle]
const pw = require('playwright')
const fs = require('fs')
const [engine, seedQ, out, thr] = process.argv.slice(2)
const throttle = Number(thr ?? 1)
const PORT = process.env.PORT ?? 4173
;(async () => {
  const launch = engine === 'webkit' ? {} : { executablePath: process.env.CHROME ?? undefined, args: ['--js-flags=--max-old-space-size=8192'] }
  if (!launch.executablePath) delete launch.executablePath
  const browser = await pw[engine].launch(launch)
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.addInitScript(() => {
    if (location.search.includes('shiftdate')) {
      const delta = new Date('2026-10-09T10:00:00').getTime() - Date.now()
      const RealDate = Date
      class ShiftedDate extends RealDate { constructor(...a) { if (a.length === 0) super(RealDate.now() + delta); else super(...a) } static now() { return RealDate.now() + delta } }
      window.Date = ShiftedDate
    }
    window.__gaps = []
    let last = performance.now()
    const tick = (t) => { const d = t - last; if (d > 50) window.__gaps.push([Math.round(last), Math.round(d)]); last = t; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
  page.on('pageerror', (e) => console.error('pageerror', String(e).slice(0, 300)))
  const t0 = Date.now()
  await page.goto(`http://localhost:${PORT}/?${seedQ}`, { waitUntil: 'load' })
  await page.waitForSelector('.ProseMirror', { timeout: 1800000 })
  const editorMs = Date.now() - t0
  console.error('editor visible', editorMs)
  for (;;) {
    await page.waitForTimeout(3000)
    const s = await page.evaluate(() => { const l = window.__ipc; const last = [...l].reverse().find((e) => e.command.startsWith('index_')); return { last: last ? performance.now() - last.t0 : 1e9, now: performance.now() } })
    if (s.last > 8000 && s.now > 15000) break
  }
  const indexedMs = Date.now() - t0
  const notes = await page.evaluate(() => window.__reflectDev.query('select count(*) c from notes', [])[0].c)
  console.error('indexed', indexedMs, 'notes', notes)
  const cdp = engine === 'chromium' ? await page.context().newCDPSession(page) : null
  const results = { engine, seedQ, throttle, notes, editorMs, indexedMs, steps: {} }
  const summarize = (ipc) => {
    const by = {}
    for (const e of ipc) { const k = e.command === 'db_query' ? 'q:' + e.sql.replace(/\s+/g, ' ').slice(0, 140) : e.command; const v = by[k] ??= { n: 0, ms: 0, rows: 0, stack: '' }; v.n++; v.ms += e.ms; v.rows += Math.max(0, e.rows); if (e.stack && !v.stack) v.stack = e.stack }
    return Object.entries(by).sort((a, b) => b[1].ms - a[1].ms).slice(0, 20).map(([k, v]) => ({ k, n: v.n, ms: Math.round(v.ms), rows: v.rows, stack: v.stack }))
  }
  async function step(name, fn, wait = 5000) {
    if (cdp) { await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start') }
    await page.evaluate(() => { window.__ipc.length = 0; window.__gaps.length = 0 })
    const tStart = Date.now()
    await fn()
    const actMs = Date.now() - tStart
    await page.waitForTimeout(wait)
    if (cdp) { const { profile } = await cdp.send('Profiler.stop'); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); fs.writeFileSync(`${out}.${name}.cpuprofile`, JSON.stringify(profile)) }
    const data = await page.evaluate(() => ({ ipc: window.__ipc.slice(), gaps: window.__gaps.slice(), dom: document.getElementsByTagName('*').length, heap: performance.memory?.usedJSHeapSize ?? null }))
    const gaps = data.gaps.map((g) => g[1]).sort((a, b) => b - a)
    const r = { actMs, dom: data.dom, heapMB: data.heap ? Math.round(data.heap / 1e6) : null, ipcN: data.ipc.length, ipcRows: data.ipc.reduce((a, e) => a + Math.max(0, e.rows), 0), gapN: gaps.length, gapSum: gaps.reduce((a, b) => a + b, 0), gapMax: gaps.slice(0, 6), top: summarize(data.ipc) }
    results.steps[name] = r
    console.error(name, JSON.stringify({ actMs, ipcN: r.ipcN, rows: r.ipcRows, gapN: r.gapN, gapSum: r.gapSum, gapMax: r.gapMax, dom: r.dom, heapMB: r.heapMB }))
  }
  const pick = await page.evaluate(() => {
    const q = window.__reflectDev.query
    const hub = q("select n.path from (select target_key, count(*) c from links group by target_key order by c desc limit 5) t join notes n on n.title_key = t.target_key order by t.c desc limit 1", [])
    const big = q("select n.path from notes n join note_text t on t.path = n.path where n.kind='note' order by length(t.text) desc limit 3", [])
    const plain = q("select path from notes where kind = 'note' and daily_date is null order by path limit 30 offset 50", [])
    return { hub: hub[0]?.path, big: big.map((r) => r.path), plain: plain.map((r) => r.path) }
  }).catch((e) => ({ err: String(e) }))
  console.error('pick', JSON.stringify(pick).slice(0, 300))
  const nav = (route) => page.evaluate((r) => { const rs = window.__routers; rs[rs.length - 1].navigate(r) }, route)
  const scroll = async () => { await page.mouse.move(720, 450); for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(30) } }
  await step('idle-20s', async () => {}, 20000)
  await step('note-plain', () => nav({ kind: 'note', path: pick.plain[0] }))
  if (pick.hub) await step('note-hub', () => nav({ kind: 'note', path: pick.hub }))
  if (pick.big?.[0]) { await step('note-big', () => nav({ kind: 'note', path: pick.big[0] })); await step('scroll-big', scroll, 2000) }
  await step('daily', () => nav({ kind: 'today' }))
  await step('scroll-daily', scroll, 2000)
  await step('open-25-tabs', async () => { for (const p of pick.plain.slice(1, 26)) { await nav({ kind: 'note', path: p }); await page.waitForTimeout(400) } }, 3000)
  await step('switch-tabs-10', async () => { for (let i = 0; i < 10; i++) { await nav({ kind: 'note', path: pick.plain[1 + ((i * 7) % 25)] }); await page.waitForTimeout(500) } }, 3000)
  await step('type-20-chars', async () => {
    await nav({ kind: 'note', path: pick.big?.[1] ?? pick.plain[2] }); await page.waitForTimeout(3000)
    await page.locator('.ProseMirror p').nth(2).click().catch(() => page.click('.ProseMirror'))
    await page.keyboard.press('End')
    for (const ch of 'hello kore fast typo ') { await page.keyboard.type(ch); await page.waitForTimeout(110) }
  }, 6000)
  fs.writeFileSync(`${out}.json`, JSON.stringify(results, null, 1))
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
