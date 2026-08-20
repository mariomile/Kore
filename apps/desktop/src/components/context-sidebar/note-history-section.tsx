import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { gitNoteHistory, type NoteVersion } from '@reflect/core'
import { NoteHistoryDialog } from '@/components/note-history-dialog'
import { formatRecencyLabel } from '@/lib/dates'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'
import { SidebarSection } from './sidebar-section'

interface NoteHistorySectionProps {
  /** Graph-relative path of the note whose versions are listed. */
  path: string
}

/** Timeline rows shown inline; the dialog holds the full list. */
const INLINE_VERSIONS = 5

/**
 * "History" as a context-sidebar section: the note's most recent versions
 * from the graph's local Git backup, each opening the history dialog on that
 * version (full preview, per-save diff, restore). Graphs without a
 * repository yet — or platforms without one — simply show the empty state:
 * the query maps every failure to an empty timeline.
 */
export function NoteHistorySection({ path }: NoteHistorySectionProps): ReactElement {
  const { graph } = useGraph()
  const { settings } = useSettings()
  const generation = graph?.generation ?? null
  const [dialogCommit, setDialogCommit] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const history = useQuery({
    queryKey: ['note-history', path],
    enabled: generation !== null,
    staleTime: 30_000,
    queryFn: async (): Promise<NoteVersion[]> => {
      if (generation === null) {
        return []
      }
      try {
        return await gitNoteHistory(path, generation)
      } catch {
        return []
      }
    },
  })
  const versions = history.data ?? []

  const openAt = (commit: string | null): void => {
    setDialogCommit(commit)
    setDialogOpen(true)
  }

  return (
    <SidebarSection storageKey="note-history" title="History">
      {versions.length === 0 ? (
        <p className="px-2 text-xs text-text-muted">
          No versions yet — they appear as backup commits your edits.
        </p>
      ) : (
        <ol className="space-y-0.5">
          {versions.slice(0, INLINE_VERSIONS).map((version) => (
            <li key={version.commit}>
              <button
                type="button"
                onClick={() => {
                  openAt(version.commit)
                }}
                className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left transition-colors duration-100 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                <span className="shrink-0 text-xs font-medium text-text">
                  {formatRecencyLabel(version.timeMs, settings)}
                </span>
                <span className="truncate text-2xs text-text-muted">{version.summary}</span>
              </button>
            </li>
          ))}
          {versions.length > INLINE_VERSIONS ? (
            <li>
              <button
                type="button"
                onClick={() => {
                  openAt(null)
                }}
                className="w-full rounded-md px-2 py-1 text-left text-xs text-text-secondary transition-colors duration-100 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                All {versions.length} versions…
              </button>
            </li>
          ) : null}
        </ol>
      )}
      <NoteHistoryDialog
        path={path}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialCommit={dialogCommit}
      />
    </SidebarSection>
  )
}
