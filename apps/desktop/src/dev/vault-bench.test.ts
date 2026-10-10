import { describe, expect, it } from 'vitest'
import {
  getBacklinks,
  getBacklinksWithContext,
  getGraphMap,
  listNotes,
  listRecentNotes,
  reconcileIndex,
  searchNotes,
  setBridge,
  suggestWikiLinkTargets,
  syncIndex,
  type IpcBridge,
} from '@reflect/core'
import { createDevBridge } from '@/dev/dev-bridge'
import { createDevFileStore } from '@/dev/dev-file-store'
import { createDevIndexDb } from '@/dev/dev-index-db'
import { seedObsidianVaultFiles } from '@/dev/seed-obsidian-vault'
import { createGraphLayout, isSettled, stepGraphLayout } from '@/lib/graph-layout'

/**
 * Opt-in scale bench, skipped unless `KORE_BENCH` is set:
 *
 *   KORE_BENCH=1 pnpm exec vitest run --project node apps/desktop/src/dev/vault-bench.test.ts
 *
 * Runs the real core pipeline and the real index schema (wasm SQLite, as in
 * plain-browser dev) over the ~5,150-note Obsidian-shaped vault, and prints
 * each phase's wall time next to the time spent inside bridge commands, so
 * TypeScript work (parse, projection, result mapping) separates from SQLite.
 * Wasm SQLite is slower than the native index; compare runs, not absolutes.
 */

const timings = new Map<string, { calls: number; ms: number }>()

function timedBridge(inner: IpcBridge): IpcBridge {
  return {
    ...inner,
    invoke: async (command, args) => {
      const started = performance.now()
      try {
        return await inner.invoke(command, args)
      } finally {
        const entry = timings.get(command) ?? { calls: 0, ms: 0 }
        entry.calls += 1
        entry.ms += performance.now() - started
        timings.set(command, entry)
      }
    },
  }
}

function report(line: string): void {
  process.stderr.write(`[bench] ${line}\n`)
}

async function phase<T>(name: string, run: () => Promise<T>): Promise<T> {
  timings.clear()
  const started = performance.now()
  const result = await run()
  const total = performance.now() - started
  const bridge = [...timings]
    .sort((left, right) => right[1].ms - left[1].ms)
    .slice(0, 3)
    .map(([command, entry]) => `${command}×${entry.calls} ${entry.ms.toFixed(0)} ms`)
    .join(', ')
  report(`${name}: ${total.toFixed(0)} ms (${bridge})`)
  return result
}

describe.skipIf(process.env.KORE_BENCH === undefined)('obsidian-shaped vault bench', () => {
  it('indexes, queries and lays out 5k notes', { timeout: 600_000 }, async () => {
    const seed = seedObsidianVaultFiles()
    const bytes = Object.values(seed).reduce((sum, text) => sum + text.length, 0)
    report(`vault: ${Object.keys(seed).length} notes, ${(bytes / 1e6).toFixed(1)} MB`)
    const files = createDevFileStore(seed)
    const index = await createDevIndexDb()
    setBridge(timedBridge(createDevBridge({ platform: 'desktop', files, index })))

    await phase('first index', () => syncIndex({ generation: 1 }))
    await phase('reopen (nothing changed)', () => reconcileIndex({ generation: 1 }))
    const notes = await phase('listNotes', () => listNotes())
    expect(notes.length).toBeGreaterThan(5_000)
    await phase('listRecentNotes(50)', () => listRecentNotes({ limit: 50 }))
    for (const query of ['growth', 'growth loop', 'g', 'lokaka']) {
      await phase(`searchNotes(${JSON.stringify(query)})`, () => searchNotes(query))
    }
    await phase('suggestWikiLinkTargets("gro")', () => suggestWikiLinkTargets('gro'))
    const hub = 'Knowledge/MOC/Growth MOC.md'
    await phase('getBacklinks(hub)', () => getBacklinks(hub))
    await phase('getBacklinksWithContext(hub)', () =>
      getBacklinksWithContext(hub, { limit: 20, cursor: null }),
    )

    const map = await phase('getGraphMap', () => getGraphMap())
    const position = new Map(map.nodes.map((node, order) => [node.path, order]))
    const edges = map.edges.flatMap((edge) => {
      const source = position.get(edge.source)
      const target = position.get(edge.target)
      return source === undefined || target === undefined
        ? []
        : [{ source, target, weight: edge.weight }]
    })
    const layout = createGraphLayout(map.nodes.map((node) => node.path))
    const steps: number[] = []
    while (!isSettled(layout)) {
      const started = performance.now()
      stepGraphLayout(layout, edges)
      steps.push(performance.now() - started)
    }
    const sorted = [...steps].sort((left, right) => left - right)
    const total = steps.reduce((sum, step) => sum + step, 0)
    report(
      `graph layout: ${map.nodes.length} nodes, ${edges.length} edges, ${steps.length} steps, ` +
        `${total.toFixed(0)} ms, step p50 ${(sorted[sorted.length >> 1] ?? 0).toFixed(1)} ms`,
    )
  })
})
