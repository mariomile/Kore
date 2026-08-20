// End-to-end smoke of the real desktop webview: Chromium drives the actual
// app served by Vite, running on the in-memory dev bridge (seeded graph +
// wasm SQLite index — see src/dev/). No Tauri shell is involved, so this
// covers everything above the IPC line: routing, editors, autosave, the
// webview indexer, FTS-backed panels, and the new-feature flows.
//
// Run with `pnpm e2e` from apps/desktop. The script owns its dev server
// (spawned on E2E_PORT, default 5199) and tears it down; Chromium comes from
// Playwright's own download (`pnpm test:install`), overridable with
// REFLECT_E2E_CHROMIUM=/path/to/chromium for prebaked environments.
//
// The scenario leans on the seed graph fixtures (src/dev/seed-graph.ts):
// renaming "Reflect V2"/"Quarterly Goals" or the "sync over Git." sentence
// there means updating the locators here.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = process.env['E2E_PORT'] ?? '5199'
const BASE = `http://127.0.0.1:${PORT}/`
const SHOTS = new URL('./shots/', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })

const results = []
function record(name, error) {
  results.push({ name, ok: error === undefined })
  console.log(
    `${error === undefined ? 'PASS' : 'FAIL'}  ${name}${error ? ` — ${error.message}` : ''}`,
  )
}
async function step(name, fn) {
  try {
    await fn()
    record(name)
  } catch (error) {
    record(name, error)
    throw error
  }
}

// ---- dev server -----------------------------------------------------------
const appDir = new URL('..', import.meta.url).pathname
const server = spawn('pnpm', ['dev', '--port', PORT, '--strictPort', '--host', '127.0.0.1'], {
  cwd: appDir,
  stdio: 'ignore',
  detached: true,
})
async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(BASE)
      if (response.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`dev server did not come up on ${BASE}`)
}
function stopServer() {
  if (server.pid !== undefined) {
    try {
      process.kill(-server.pid, 'SIGTERM')
    } catch {
      // already gone
    }
  }
}

// ---- browser --------------------------------------------------------------
const explicitChromium = process.env['REFLECT_E2E_CHROMIUM']
const prebaked = '/opt/pw-browsers/chromium'
const executablePath = explicitChromium ?? (existsSync(prebaked) ? prebaked : undefined)

let browser
try {
  await waitForServer()
  browser = await chromium.launch(executablePath ? { executablePath } : {})
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.setDefaultTimeout(20000)

  await step('app boots on the dev bridge with the seeded graph', async () => {
    await page.goto(BASE)
    // Generous first-paint budget: a cold Vite dep re-optimization (new or
    // changed dependencies) can hold the initial bundle well past the
    // default timeout.
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByText('Daily notes')
      .waitFor({ timeout: 60000 })
    await page.getByText('Morning review with').first().waitFor()
  })
  await page.screenshot({ path: `${SHOTS}01-daily.png` })

  await step('All notes lists the seeded notes', async () => {
    await page.getByRole('navigation', { name: 'Primary' }).getByText('All notes').click()
    await page.getByRole('heading', { name: 'Notes', exact: true }).waitFor()
    await page.getByText('Reflect V2').first().waitFor()
  })

  await step('grid toggle switches to the masonry cards', async () => {
    await page.getByRole('button', { name: 'Grid view' }).click()
    await page.getByText('Systems over goals').first().waitFor()
    if (await page.getByText('Updated', { exact: true }).count()) {
      throw new Error('table header still visible in grid view')
    }
  })
  await page.screenshot({ path: `${SHOTS}02-grid.png` })

  await step('a grid card opens its note', async () => {
    await page.getByText('Atomic Habits', { exact: true }).first().click()
    await page.getByText('Systems over goals. Make it obvious').first().waitFor()
  })

  await step('backlinks render on the opened note', async () => {
    await page.getByText(/Incoming backlinks? \(\d+\)/).waitFor()
  })
  await page.screenshot({ path: `${SHOTS}03-note.png` })

  await step('typing an unlinked mention into the Reflect V2 note', async () => {
    await page.getByRole('navigation', { name: 'Primary' }).getByText('All notes').click()
    await page.getByRole('button', { name: 'Grid view' }).click()
    await page.getByRole('heading', { name: 'Reflect V2' }).click()
    // A single stable editor (the daily stream virtualizes its days). Let the
    // arrival autofocus settle before claiming the caret, then append to the
    // existing paragraph — a split near the H1 would read as a title edit.
    const line = page.getByText('sync over Git.').first()
    await line.waitFor()
    await page.waitForTimeout(900)
    await line.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Refined the Quarterly Goals draft after dinner.', { delay: 15 })
    // The honest end-to-end signal: the debounced save reaches the store.
    await page.waitForFunction(
      () =>
        String(window.__reflectDev.files.read('notes/reflect-v2.md') ?? '').includes(
          'Quarterly Goals draft',
        ),
      undefined,
      { timeout: 15000 },
    )
  })

  await step('the mentioned note shows the Unlinked mentions panel', async () => {
    await page.getByRole('navigation', { name: 'Primary' }).getByText('All notes').click()
    await page.getByRole('button', { name: 'Grid view' }).click()
    await page.getByRole('heading', { name: 'Quarterly Goals', exact: true }).first().click()
    await page.getByText('1k beta signups').first().waitFor()
    await page.getByText(/Unlinked mentions? \(\d+\)/).waitFor({ timeout: 30000 })
    await page.getByText('Refined the').first().waitFor()
  })
  await page.screenshot({ path: `${SHOTS}04-unlinked.png` })

  await step('one-click Link converts the mention into a backlink', async () => {
    const before = await page.getByText(/Incoming backlinks? \((\d+)\)/).textContent()
    const beforeCount = Number(/\((\d+)\)/.exec(before ?? '')?.[1] ?? '0')
    const row = page.locator('section[aria-label="Unlinked mentions"] li').first()
    await row.hover()
    await row.getByRole('button', { name: /^Link/ }).click()
    await page.waitForFunction(
      (expected) => {
        const heading = [...document.querySelectorAll('h3')].find((node) =>
          /Incoming backlinks? \(\d+\)/.test(node.textContent ?? ''),
        )
        const count = Number(/\((\d+)\)/.exec(heading?.textContent ?? '')?.[1] ?? '0')
        return count >= expected
      },
      beforeCount + 1,
      { timeout: 30000 },
    )
    if (await page.getByText(/Unlinked mentions? \(\d+\)/).count()) {
      throw new Error('unlinked mentions section still present after linking')
    }
  })
  await page.screenshot({ path: `${SHOTS}05-linked.png` })

  await step('the visited notes ride the tab strip and switch on click', async () => {
    const strip = page.getByRole('tablist', { name: 'Open notes' })
    await strip.waitFor()
    await strip.getByRole('tab', { name: 'Daily notes' }).waitFor()
    await strip.getByRole('tab', { name: /Quarterly Goals/ }).waitFor()
    // Switch back to Reflect V2 through its tab; the note pane follows.
    await strip
      .getByRole('tab', { name: /Reflect V2/ })
      .getByText('Reflect V2')
      .click()
    await page.getByText('sync over Git.').first().waitFor()
    // The sidebar's Open section mirrors the same tabs.
    await page.getByRole('heading', { name: 'Open' }).waitFor()
  })
  await page.screenshot({ path: `${SHOTS}06-tabs.png` })

  await step('the two rails collapse and restore independently', async () => {
    const primaryNav = page.getByRole('navigation', { name: 'Primary' })
    await page.getByRole('button', { name: 'Toggle sidebar' }).click()
    if (await primaryNav.count()) {
      throw new Error('left sidebar still mounted after collapsing it')
    }
    // The context rail stands while the left one is hidden.
    await page.getByRole('tab', { name: 'Details' }).waitFor()
    await page.getByRole('button', { name: 'Toggle sidebar' }).click()
    await primaryNav.waitFor()

    await page.getByRole('button', { name: 'Toggle context panel' }).click()
    if (await page.getByRole('tab', { name: 'Details' }).count()) {
      throw new Error('context rail still mounted after collapsing it')
    }
    await primaryNav.waitFor()
    await page.getByRole('button', { name: 'Toggle context panel' }).click()
    await page.getByRole('tab', { name: 'Details' }).waitFor()
  })

  await step('a web link routes through the in-app browser command', async () => {
    await page.getByRole('navigation', { name: 'Primary' }).getByText('Daily notes').click()
    // The seeded link lives four days back — jump there via the rail calendar
    // (cells carry their full formatted date as the accessible name).
    const target = new Date(Date.now() - 4 * 86_400_000)
    const month = target.toLocaleString('en-US', { month: 'long' })
    await page
      .getByRole('button', { name: new RegExp(`${month} ${target.getDate()}(?:st|nd|rd|th),`) })
      .first()
      .click()
    const link = page.getByText('Local-first software').first()
    await link.waitFor()
    // The dev bridge stands in for the Tauri browser window with a popup
    // (window.open); record instead of opening so the run stays headless.
    await page.evaluate(() => {
      window.__openedUrls = []
      window.open = (url) => {
        window.__openedUrls.push(String(url))
        return null
      }
    })
    // In the editor, mod-click is the open gesture (a plain click places
    // the caret).
    await link.click({ modifiers: ['ControlOrMeta'] })
    await page.waitForFunction(() => (window.__openedUrls ?? []).length > 0, undefined, {
      timeout: 10000,
    })
    const opened = await page.evaluate(() => window.__openedUrls)
    if (!String(opened[0]).includes('inkandswitch.com')) {
      throw new Error(`expected the note's link, got ${JSON.stringify(opened)}`)
    }
  })

  await step('the Graph view maps the seeded notes and links', async () => {
    await page.getByRole('navigation', { name: 'Primary' }).getByText('Graph').click()
    await page.getByRole('heading', { name: 'Graph', exact: true }).waitFor()
    // The seeded graph has linked notes; exact counts vary with earlier steps,
    // so assert the summary's shape and that the canvas surface mounted.
    const summary = await page.getByText(/^\d+ notes · \d+ links$/).textContent()
    const [notes, links] = [...(summary ?? '').matchAll(/\d+/g)].map((m) => Number(m[0]))
    if (!(notes > 0 && links > 0)) {
      throw new Error(`expected a non-empty graph, got "${summary}"`)
    }
    await page.getByRole('img', { name: 'Note graph' }).waitFor()
    // Bringing daily notes in grows the node count.
    await page.getByRole('checkbox', { name: 'Daily notes' }).check()
    const withDailies = await page.getByText(/^\d+ notes · \d+ links$/).textContent()
    const notesWithDailies = Number(/(\d+) notes/.exec(withDailies ?? '')?.[1] ?? '0')
    if (notesWithDailies <= notes) {
      throw new Error(`daily toggle did not add nodes: ${summary} -> ${withDailies}`)
    }
  })
  await page.screenshot({ path: `${SHOTS}07-graph.png` })

  await step('the source note now carries the wiki link on disk', async () => {
    await page.waitForFunction(
      () =>
        String(window.__reflectDev.files.read('notes/reflect-v2.md') ?? '').includes(
          '[[Quarterly Goals]]',
        ),
      undefined,
      { timeout: 15000 },
    )
  })
} finally {
  const failures = results.filter((result) => !result.ok)
  console.log(`\n${results.length - failures.length}/${results.length} steps passed`)
  await browser?.close()
  stopServer()
  process.exit(results.length > 0 && failures.length === 0 ? 0 : 1)
}
