import { useState, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  errorMessage,
  noteFileStem,
  undoSitting,
  type ActivitySitting,
  type UndoConflictReason,
  type UndoSittingResult,
} from '@reflect/core'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { deleteOpenNote } from '@/lib/note-delete'
import { invalidateIndexQueries } from '@/lib/query-client'

interface UndoSittingDialogProps {
  sitting: ActivitySitting
  /** Who made the sitting, as the Activity screen names them. */
  authorName: string
  generation: number
  onClose: () => void
}

const REASON: Record<UndoConflictReason, string> = {
  changedSince: 'edited again since',
  binary: 'not a text file',
  notANote: 'not a note',
}

/**
 * Confirm and run the undo of one sitting. Nothing is written when any
 * note blocks it; the dialog then names those notes so they can be fixed
 * by hand (or from the note's history).
 */
export function UndoSittingDialog({
  sitting,
  authorName,
  generation,
  onClose,
}: UndoSittingDialogProps): ReactElement {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<UndoSittingResult | null>(null)
  const count = sitting.notes.length
  const notes = count === 1 ? '1 note' : `${count} notes`

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const outcome = await undoSitting(sitting, generation, { remove: deleteOpenNote })
      setResult(outcome)
      invalidateIndexQueries()
      await queryClient.invalidateQueries({ queryKey: ['activity'] })
      await queryClient.invalidateQueries({ queryKey: ['note-history'] })
      if (outcome.kind === 'undone') {
        onClose()
      }
    } catch (caught: unknown) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) {
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogTitle>Undo {authorName}’s changes?</DialogTitle>
        {result?.kind === 'conflict' ? (
          <>
            <DialogDescription>
              Nothing was undone. These notes changed again after {authorName}’s edits, so undoing
              would lose newer work:
            </DialogDescription>
            <ul className="mt-2 space-y-0.5 text-sm">
              {result.conflicts.map((conflict) => (
                <li key={conflict.path} className="flex items-baseline gap-2">
                  <span className="truncate text-text">{noteFileStem(conflict.path)}</span>
                  <span className="shrink-0 text-2xs text-text-muted">
                    {REASON[conflict.reason]}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : result?.kind === 'nothing' ? (
          <DialogDescription>These changes are already undone.</DialogDescription>
        ) : (
          <DialogDescription>
            This puts back {notes} as they were before. Edits made since, by you or anyone else, are
            kept. The undo shows up here as your own change, so you can undo it too.
          </DialogDescription>
        )}
        {error !== null ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter className="mt-4">
          <DialogClose
            render={
              <Button type="button" variant="ghost" disabled={busy}>
                {result === null ? 'Cancel' : 'Close'}
              </Button>
            }
          />
          {result === null ? (
            <Button type="button" disabled={busy} onClick={() => void run()}>
              {busy ? 'Undoing…' : 'Undo'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
