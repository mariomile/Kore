import { errorMessage } from '@reflect/core'

export interface AdoptGraphToIcloudParams {
  readonly generation: number
  readonly backupConnected: boolean
  readonly adopt: (generation: number) => Promise<string>
  readonly disconnectGraph: () => Promise<void>
  readonly openRecent: (root: string) => Promise<boolean>
}

export interface AdoptGraphToIcloudResult {
  readonly newRoot: string
  readonly opened: boolean
  readonly warning: string | null
}

/**
 * Copy the open graph into iCloud Drive, then reopen it there (Plan 21
 * move-in). Copy-first so a failed copy leaves the original folder — and
 * its Git backup, if any — untouched. A Git remote is disconnected from the
 * original afterwards (iCloud and Git are mutually exclusive); a disconnect
 * failure is a warning, not a rollback, because the iCloud copy has no
 * `.git` either way.
 */
export async function adoptGraphToIcloud(
  params: AdoptGraphToIcloudParams,
): Promise<AdoptGraphToIcloudResult> {
  const newRoot = await params.adopt(params.generation)
  const warnings: string[] = []
  if (params.backupConnected) {
    try {
      await params.disconnectGraph()
    } catch (caught) {
      warnings.push(
        `The graph moved to iCloud, but GitHub sync could not be disconnected from the original folder: ${errorMessage(caught)}`,
      )
    }
  }
  const opened = await params.openRecent(newRoot)
  if (!opened) {
    warnings.push('The copy landed in iCloud but could not be opened — open it from Saved graphs.')
  }
  return {
    newRoot,
    opened,
    warning: warnings.length === 0 ? null : warnings.join(' '),
  }
}
