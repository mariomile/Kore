import { useCallback, useState, type ReactElement } from 'react'
import { Undo } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useVaultReplaceDialog } from '@/providers/vault-replace-provider'
import {
  EMPTY_SCAN,
  useVaultReplace,
  type ReplaceScope,
  type ScanResult,
} from '@/lib/notes/use-vault-replace'

interface VaultReplaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Prefill the needle — the note find bar hands its query over. */
  seed?: string
}

/**
 * Replace across every note.
 *
 * A dialog rather than a screen, deliberately: `search-route.tsx` records the
 * decision that the app has one search surface, and this is a mutation with a
 * preview rather than a place to browse.
 *
 * The interaction is scan → review → apply, and the review step is the whole
 * point. Nothing is written until the user has seen the count, the per-note
 * breakdown, and what was refused. Refusals are listed rather than dropped:
 * a note with unsaved edits, or one whose matches are all inside code, links,
 * frontmatter or its own title, appears with the reason instead of quietly
 * lowering the number.
 *
 * Defaults are the conservative pair — match case **on**, whole word **on** —
 * and they do not persist between runs. A sticky "whole word: off" from three
 * weeks ago silently changing what today's replace does is exactly the kind
 * of surprise this dialog exists to prevent.
 */
export function VaultReplaceDialog({
  open,
  onOpenChange,
  seed = '',
}: VaultReplaceDialogProps): ReactElement | null {
  const { scan, apply, undo, canUndo, isBusy } = useVaultReplace()
  const [needle, setNeedle] = useState(seed)
  const [replacement, setReplacement] = useState('')
  const [matchCase, setMatchCase] = useState(true)
  const [wholeWord, setWholeWord] = useState(true)
  // The preview is stored *with the inputs it describes*, so going stale is a
  // derivation rather than an effect that races the render: change the needle
  // or a toggle and the old count stops being shown, with nothing to reset.
  const [preview, setPreview] = useState<{ scope: ReplaceScope; result: ScanResult } | null>(null)

  const scope: ReplaceScope = { needle, replacement, matchCase, wholeWord }
  const describesNow =
    preview !== null &&
    preview.scope.needle === needle &&
    preview.scope.matchCase === matchCase &&
    preview.scope.wholeWord === wholeWord
  const result = describesNow ? preview.result : EMPTY_SCAN

  const runScan = useCallback(
    async (next: ReplaceScope) => {
      setPreview({ scope: next, result: await scan(next) })
    },
    [scan],
  )

  const blocked = result.notes.filter((note) => note.blocked !== null)
  const ready = describesNow && result.changeable > 0

  return (
    <Dialog open={open} onOpenChange={isBusy ? () => {} : onOpenChange}>
      <DialogContent className="flex h-[70vh] w-[min(44rem,92vw)] flex-col gap-0 overflow-hidden p-0">
        <div className="flex-none border-b border-border px-4 py-3">
          <DialogTitle>Replace in vault</DialogTitle>
        </div>

        <form
          className="flex-none space-y-3 border-b border-border px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault()
            void runScan(scope)
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <Input
              autoFocus
              aria-label="Find"
              placeholder="Find"
              value={needle}
              onChange={(event) => setNeedle(event.target.value)}
            />
            <Input
              aria-label="Replace with"
              placeholder="Replace with"
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-text-secondary">
            <label className="flex cursor-pointer items-center gap-1.5">
              <Checkbox
                checked={matchCase}
                onCheckedChange={(next) => setMatchCase(next === true)}
              />
              Match case
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <Checkbox
                checked={wholeWord}
                onCheckedChange={(next) => setWholeWord(next === true)}
              />
              Whole word
            </label>
            <Button
              type="submit"
              variant="outline"
              disabled={isBusy || needle === ''}
              className="ml-auto"
            >
              {isBusy ? 'Scanning…' : 'Preview'}
            </Button>
          </div>
        </form>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {!describesNow ? (
            <p className="text-sm text-text-muted">
              Nothing is written until you preview and confirm. Code, link targets, frontmatter and
              each note&rsquo;s own title are never rewritten.
            </p>
          ) : result.notes.length === 0 ? (
            <p className="text-sm text-text-muted">No matches.</p>
          ) : (
            <>
              <p role="status" aria-live="polite" className="mb-3 text-sm text-text">
                {result.liveMatches} {result.liveMatches === 1 ? 'match' : 'matches'} in{' '}
                {result.changeable} {result.changeable === 1 ? 'note' : 'notes'}
                {result.skippedMatches > 0
                  ? ` · ${result.skippedMatches} protected in code, links, frontmatter or titles`
                  : ''}
                {blocked.length > 0 ? ` · ${blocked.length} blocked` : ''}
              </p>
              <ul className="space-y-1">
                {result.notes.map((note) => (
                  <li
                    key={note.path}
                    className={cn(
                      'flex items-baseline justify-between gap-3 rounded-md px-2 py-1 text-[13px]',
                      note.blocked === null && note.live > 0
                        ? 'text-text'
                        : 'text-text-muted line-through decoration-text-muted/40',
                    )}
                  >
                    <span className="truncate">{note.title}</span>
                    <span className="flex-none tabular-nums text-text-muted">
                      {note.blocked ??
                        (note.live > 0 ? String(note.live) : `${note.matches.length} protected`)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <DialogFooter className="flex-none border-t border-border px-4 py-3">
          {canUndo ? (
            <Button
              type="button"
              variant="ghost"
              disabled={isBusy}
              onClick={() => void undo()}
              className="mr-auto text-text-secondary"
            >
              <Undo aria-hidden className="size-3.5" />
              Undo last replace
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={isBusy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isBusy || !ready}
            onClick={() => {
              void apply(scope, result).then(() => {
                setPreview(null) // the run consumed it; a fresh preview is required
              })
            }}
          >
            {ready
              ? `Replace ${result.liveMatches} in ${result.changeable} ${result.changeable === 1 ? 'note' : 'notes'}`
              : 'Replace'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The dialog wired to its provider — mounted unconditionally beside the
 * palette and the cheat-sheet, returning null while closed, so the command
 * and the find bar's hand-off both have somewhere to open into.
 */
export function VaultReplaceMount(): ReactElement | null {
  const { open, seed, closeVaultReplace } = useVaultReplaceDialog()
  if (!open) {
    // Unmounting is the reset: every open starts from the seed and the
    // conservative defaults, with no effect to keep them in step.
    return null
  }
  return (
    <VaultReplaceDialog
      open
      seed={seed}
      onOpenChange={(next) => {
        if (!next) {
          closeVaultReplace()
        }
      }}
    />
  )
}
