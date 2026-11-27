import { setBridge, setLocalWriteEcho, type AppPlatform } from '@kore/core'
import { createDevBridge } from '@/dev/dev-bridge'
import { createDevFileStore } from '@/dev/dev-file-store'
import { createDevIndexDb } from '@/dev/dev-index-db'
import { seedGraphFiles } from '@/dev/seed-graph'

let installation: Promise<void> | null = null

/**
 * Install the in-browser dev bridge (dev builds only): an in-memory graph
 * seeded with demo notes, backed by the real index schema in wasm SQLite.
 * Loaded lazily by `PlatformRoot` whenever plain-browser dev has no native
 * shell — with platform `desktop` by default, or `ios`/`android` when the
 * `?platform=` override forces the mobile tree. The chosen tree then boots
 * through its ordinary path: graph open, full index rebuild from the seeded
 * files, queries over `db_query`.
 *
 * Idempotent: React 19 StrictMode double-fires the installing effect, and the
 * second call must not re-seed or swap the bridge mid-boot.
 */
export function installDevBridge(platform: AppPlatform): Promise<void> {
  installation ??= install(platform)
  return installation
}

async function install(platform: AppPlatform): Promise<void> {
  const index = await createDevIndexDb()
  // `?seed=large` swaps the demo graph for the profiling vault (thousands
  // of notes), `?seed=obsidian` for the Obsidian-shaped one, `?seed=visual`
  // for a few notes with pictures; their modules only load when asked for.
  const seedName = new URLSearchParams(window.location.search).get('seed')
  const visual =
    seedName === 'visual' ? (await import('@/dev/seed-visual-vault')).seedVisualVault() : null
  const seed =
    visual !== null
      ? visual.files
      : seedName === 'json'
        ? ((await (await fetch('/vault.json')).json()) as Record<string, string>)
      : seedName === 'large'
        ? (await import('@/dev/seed-large-graph')).seedLargeGraphFiles()
        : seedName === 'obsidian'
          ? await (async () => {
              const mod = await import('@/dev/seed-obsidian-vault')
              const scale = Number(new URLSearchParams(window.location.search).get('scale') ?? '1')
              const base = mod.OBSIDIAN_VAULT_DEFAULTS
              return mod.seedObsidianVaultFiles(
                Object.fromEntries(
                  Object.entries(base).map(([key, value]) => [key, Math.round(value * scale)]),
                ) as typeof base,
              )
            })()
          : seedGraphFiles()
  const files = createDevFileStore(seed)
  const inner = createDevBridge({
    platform,
    files,
    index,
    ...(visual !== null ? { assets: visual.assets } : {}),
  })
  const ipcLog: unknown[] = []
  Object.assign(window, { __ipc: ipcLog })
  setBridge({
    ...inner,
    invoke: async (command, args) => {
      const t0 = performance.now()
      const result = await inner.invoke(command, args)
      const ms = performance.now() - t0
      const sql = command === 'db_query' ? String((args as { sql?: string }).sql ?? '').slice(0, 300) : ''
      const rows = Array.isArray(result) ? result.length : -1
      ipcLog.push({ t0, ms, command, sql, rows, stack: rows > 2000 || ms > 50 ? new Error().stack?.split('\n').slice(2, 14).join('|') : '' })
      return result
    },
  })
  // No watcher exists in plain-browser dev (the Rust watcher is desktop's
  // change source), so let the write commands echo their own changes —
  // exactly the mobile arrangement — or edits never reindex until reload.
  setLocalWriteEcho(true)
  // A console handle for poking the shim while debugging mobile surfaces:
  // `__reflectDev.query('select path, title from notes')`, `.files.read(...)`.
  Object.assign(window, { __reflectDev: { query: index.query, files } })
  console.info(`[dev-bridge] installed: platform=${platform}, in-memory graph + wasm SQLite index`)
}
