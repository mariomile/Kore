import { errorMessage } from '../errors'
import { setBridge } from '../ipc/bridge'
import { openIndex } from '../indexing/commands'
import { rebuildIndex, syncIndex } from '../indexing/indexer'
import { createStdioBridge } from './stdio-bridge'

/**
 * The headless indexer's entry point (`kore index`): the same projection the
 * desktop app builds on open, driven from Node with no app running. The CLI
 * spawns this script with piped stdio and serves its native commands (file
 * listing, note reads, the index writes) itself; see `apps/cli/src/indexer.rs`.
 *
 * Stdout carries the bridge protocol, so every log goes to stderr. Exits 0
 * when the index is current, 1 on failure, 2 when some notes were skipped
 * (unreadable or failing to parse; each one is named on stderr).
 */
async function main(argv: readonly string[]): Promise<number> {
  // Library code logs with console.log/info in places; on stdout that would
  // corrupt the protocol stream.
  console.log = console.error
  console.info = console.error

  const bridge = createStdioBridge(process.stdin, process.stdout)
  setBridge(bridge)
  let skipped = 0
  try {
    const generation = await openIndex()
    const options = {
      generation,
      onSkippedNote: (note: { path: string; message: string }): void => {
        skipped += 1
        console.error(`kore index: skipped ${note.path}: ${note.message}`)
      },
    }
    if (argv.includes('--rebuild')) {
      await rebuildIndex(options)
    } else {
      await syncIndex(options)
    }
  } finally {
    bridge.close()
  }
  return skipped > 0 ? 2 : 0
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(`kore index: ${errorMessage(error)}`)
    process.exitCode = 1
  },
)
