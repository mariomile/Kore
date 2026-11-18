import type { ReactElement } from 'react'
import { normalizeTagInput } from '@kore/core'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { isMobileSurface } from '@/lib/platform-surface'
import { TagRenameSheet } from './tag-rename-sheet'
import { TagRenameSummary } from './tag-rename-summary'
import { useTagRenameForm } from './use-tag-rename-form'

export interface TagRenameDialogProps {
  /** The tag to rename, display casing. */
  tag: string
  /** Closed: `renamedTo` is the new name when a rename stayed applied. */
  onClose: (renamedTo: string | null) => void
}

/**
 * Rename a tag everywhere, or merge it into another (Tag Wrangler in
 * Obsidian). Opened from a tag's settings. The preview is live as the name is
 * typed and nothing is written until Rename; afterwards the dialog shows what
 * changed and offers Undo. On the phone the same form is a bottom sheet
 * ({@link TagRenameSheet}).
 */
export function TagRenameDialog(props: TagRenameDialogProps): ReactElement {
  return isMobileSurface() ? <TagRenameSheet {...props} /> : <TagRenameDesktop {...props} />
}

function TagRenameDesktop({ tag, onClose }: TagRenameDialogProps): ReactElement {
  const form = useTagRenameForm(tag)
  const close = (): void => {
    onClose(form.result?.kind === 'renamed' ? form.result.to : null)
  }
  const merges = form.preview?.plan.merges === true

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !form.isBusy) close()
      }}
    >
      <DialogContent className="flex w-[min(28rem,92vw)] flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <DialogTitle className="text-base font-semibold text-text">
            Rename #{normalizeTagInput(tag)}
          </DialogTitle>
          <DialogDescription className="text-xs text-text-muted">
            Every note that carries it changes, and nested tags follow. Use an existing name to
            merge the two.
          </DialogDescription>
        </div>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (form.result === null && form.canSubmit) void form.submit()
          }}
        >
          <InputGroup>
            <InputGroupAddon className="text-text-muted">#</InputGroupAddon>
            <InputGroupInput
              aria-label="New tag name"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              disabled={form.result !== null}
              value={form.value}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => form.setValue(event.currentTarget.value)}
            />
          </InputGroup>
          <TagRenameSummary form={form} from={tag} />
        </form>
        <DialogFooter className="m-0 gap-2 border-t-0 bg-transparent p-0">
          {form.result === null ? (
            <>
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="button" disabled={!form.canSubmit} onClick={() => void form.submit()}>
                {merges ? 'Merge' : 'Rename'}
              </Button>
            </>
          ) : (
            <>
              {form.result.kind === 'renamed' && form.canUndo ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={form.isBusy}
                  onClick={() => void form.undo()}
                >
                  Undo
                </Button>
              ) : null}
              <Button type="button" disabled={form.isBusy} onClick={close}>
                Done
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
