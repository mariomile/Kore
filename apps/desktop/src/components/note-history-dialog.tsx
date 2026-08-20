import { useMemo, useState, type ReactElement } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  emitFileChanges,
  errorMessage,
  gitCommitAll,
  gitNoteHistory,
  gitNoteVersion,
  indexNote,
  noteFileStem,
  writeNote,
  type NoteVersion,
} from '@reflect/core'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatRecencyLabel } from '@/lib/dates'
import { diffLines } from '@/lib/line-diff'
import { invalidateIndexQueries } from '@/lib/query-client'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'

interface NoteHistoryDialogProps {
  /** Graph-relative path of the note whose history is shown. */
  path: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The version selected when the dialog opens (defaults to the newest). */
  initialCommit?: string | null
}

type HistoryView = 'preview' | 'changes'

/**
 * Per-note version history over the graph's local Git backup: a timeline of
 * every commit that changed the note, each viewable in full or as the diff
 * against the version before it, with one-click restore. Restore is
 * non-destructive by construction — the current state is committed first
 * (`gitCommitAll` no-ops when clean), then the old content is written back
 * through the ordinary note write path, so the restore itself becomes the
 * newest version and nothing is ever lost.
 */
export function NoteHistoryDialog({
  path,
  open,
  onOpenChange,
  initialCommit = null,
}: NoteHistoryDialogProps): ReactElement {
  const { graph, indexGeneration } = useGraph()
  const { settings } = useSettings()
  const queryClient = useQueryClient()
  const generation = graph?.generation ?? null

  const history = useQuery({
    queryKey: ['note-history', path],
    enabled: open && generation !== null,
    queryFn: async () => (generation === null ? [] : await gitNoteHistory(path, generation)),
  })
  const versions: NoteVersion[] = useMemo(() => history.data ?? [], [history.data])

  const [selected, setSelected] = useState<string | null>(initialCommit)
  const [view, setView] = useState<HistoryView>('preview')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Render-time reset (no effect): every open — and every open at a new
  // version — starts from that version's preview with a clean error slate.
  const [resetKey, setResetKey] = useState('closed')
  const currentKey = open ? `open:${initialCommit ?? '__head'}` : 'closed'
  if (resetKey !== currentKey) {
    setResetKey(currentKey)
    if (open) {
      setSelected(initialCommit)
      setView('preview')
      setError(null)
    }
  }

  const selectedCommit = selected ?? versions[0]?.commit ?? null
  const selectedIndex = versions.findIndex((version) => version.commit === selectedCommit)
  const previousCommit = selectedIndex >= 0 ? (versions[selectedIndex + 1]?.commit ?? null) : null

  const selectedContent = useQuery({
    queryKey: ['note-version', path, selectedCommit],
    enabled: open && generation !== null && selectedCommit !== null,
    queryFn: async () =>
      generation === null || selectedCommit === null
        ? ''
        : await gitNoteVersion(selectedCommit, path, generation),
  })
  const previousContent = useQuery({
    queryKey: ['note-version', path, previousCommit],
    enabled: open && generation !== null && previousCommit !== null && view === 'changes',
    queryFn: async () =>
      generation === null || previousCommit === null
        ? ''
        : await gitNoteVersion(previousCommit, path, generation),
  })

  const diff = useMemo(() => {
    if (view !== 'changes' || selectedContent.data === undefined) {
      return []
    }
    return diffLines(
      previousCommit === null ? '' : (previousContent.data ?? ''),
      selectedContent.data,
    )
  }, [view, selectedContent.data, previousContent.data, previousCommit])

  const restore = async (): Promise<void> => {
    if (generation === null || selectedCommit === null) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const content = await gitNoteVersion(selectedCommit, path, generation)
      // Snapshot whatever is current first, so the restore can itself be
      // undone from this same timeline.
      await gitCommitAll(`Snapshot before restoring ${path}`, generation)
      await writeNote(path, content, generation)
      if (indexGeneration !== null) {
        await indexNote(path, { generation: indexGeneration, content })
      }
      emitFileChanges([{ path, kind: 'upsert' }])
      invalidateIndexQueries()
      await queryClient.invalidateQueries({ queryKey: ['note-history', path] })
      onOpenChange(false)
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] w-[min(56rem,92vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-sm font-medium">History — {noteFileStem(path)}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          <aside className="w-60 shrink-0 overflow-y-auto border-r border-border p-2">
            {versions.length === 0 ? (
              <p className="px-2 py-1 text-xs text-text-muted">
                {history.isPending ? 'Loading versions…' : 'No saved versions yet.'}
              </p>
            ) : (
              <ol className="space-y-0.5">
                {versions.map((version) => (
                  <li key={version.commit}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(version.commit)
                      }}
                      className={cn(
                        'flex w-full flex-col rounded-md px-2 py-1.5 text-left transition-colors duration-100',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                        version.commit === selectedCommit
                          ? 'bg-surface-hover text-text'
                          : 'text-text-secondary hover:bg-surface-hover/60',
                      )}
                    >
                      <span className="text-xs font-medium">
                        {formatRecencyLabel(version.timeMs, settings)}
                      </span>
                      <span className="truncate text-2xs text-text-muted">{version.summary}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <div className="flex gap-0.5 rounded-lg bg-surface-hover p-0.5">
                {(['preview', 'changes'] as const).map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => {
                      setView(candidate)
                    }}
                    aria-pressed={view === candidate}
                    className={cn(
                      'h-6 rounded-md px-2 text-xs transition-colors duration-100',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                      view === candidate
                        ? 'bg-surface text-text shadow-sm'
                        : 'text-text-secondary hover:text-text',
                    )}
                  >
                    {candidate === 'preview' ? 'Preview' : 'Changes'}
                  </button>
                ))}
              </div>
              <Button
                type="button"
                size="sm"
                className="ml-auto"
                disabled={busy || selectedCommit === null}
                onClick={() => {
                  void restore()
                }}
              >
                {busy ? 'Restoring…' : 'Restore this version'}
              </Button>
            </div>
            {error !== null ? (
              <p role="alert" className="border-b border-border px-4 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {view === 'preview' ? (
                <pre className="whitespace-pre-wrap font-mono text-xs leading-5 text-text">
                  {selectedContent.data ?? ''}
                </pre>
              ) : (
                <div className="font-mono text-xs leading-5">
                  {diff.map((line, index) => (
                    <div
                      key={index}
                      className={cn(
                        'whitespace-pre-wrap px-1',
                        line.kind === 'added' && 'bg-accent/10 text-text',
                        line.kind === 'removed' && 'bg-destructive/10 text-destructive',
                        line.kind === 'same' && 'text-text-secondary',
                      )}
                    >
                      <span
                        aria-hidden
                        className="mr-2 inline-block w-3 select-none text-text-muted"
                      >
                        {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
                      </span>
                      {line.text === '' ? ' ' : line.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="border-t border-border px-4 py-2 text-2xs text-text-muted">
              Restoring writes this version back as a new change — the current state is kept in
              history first, so nothing is lost.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
