import type { ReactElement } from 'react'
import { normalizeTagInput } from '@kore/core'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import type { TagRenameDialogProps } from './tag-rename-dialog'
import { TagRenameSummary } from './tag-rename-summary'
import { useTagRenameForm } from './use-tag-rename-form'

/**
 * The rename on the phone: the same form and preview as the Mac dialog, as a
 * bottom sheet with the iOS header (Cancel, title, primary action), large
 * targets and body-size text.
 */
export function TagRenameSheet({ tag, onClose }: TagRenameDialogProps): ReactElement {
  const form = useTagRenameForm(tag)
  const close = (): void => {
    onClose(form.result?.kind === 'renamed' ? form.result.to : null)
  }
  const merges = form.preview?.plan.merges === true
  const done = form.result !== null
  const canUndo = form.result?.kind === 'renamed' && form.canUndo

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open && !form.isBusy) close()
      }}
    >
      <DrawerContent>
        <div className="flex items-center gap-2 border-b border-border px-3 pb-3 pt-1">
          {!done ? (
            <Button type="button" variant="ghost" className="h-10 px-3 text-base" onClick={close}>
              Cancel
            </Button>
          ) : canUndo ? (
            <Button
              type="button"
              variant="ghost"
              className="h-10 px-3 text-base"
              disabled={form.isBusy}
              onClick={() => void form.undo()}
            >
              Undo
            </Button>
          ) : (
            // Keeps the title centred between the two header actions.
            <span aria-hidden className="w-[4.5rem]" />
          )}
          <DrawerTitle className="min-w-0 flex-1 truncate px-0 pt-0 text-center text-base font-semibold">
            Rename #{normalizeTagInput(tag)}
          </DrawerTitle>
          {done ? (
            <Button
              type="button"
              className="h-10 px-4 text-base"
              disabled={form.isBusy}
              onClick={close}
            >
              Done
            </Button>
          ) : (
            <Button
              type="button"
              className="h-10 px-4 text-base"
              disabled={!form.canSubmit}
              onClick={() => void form.submit()}
            >
              {merges ? 'Merge' : 'Rename'}
            </Button>
          )}
        </div>
        <form
          className="flex flex-col gap-3 px-4 pb-8 pt-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!done && form.canSubmit) void form.submit()
          }}
        >
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-text-muted"
            >
              #
            </span>
            <Input
              aria-label="New tag name"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              disabled={done}
              value={form.value}
              onChange={(event) => form.setValue(event.currentTarget.value)}
              className="h-12 pl-7 text-base"
            />
          </div>
          <p className="px-1 text-sm text-text-muted">
            Every note that carries it changes, and nested tags follow. Use an existing name to
            merge the two.
          </p>
          <div className="px-1">
            <TagRenameSummary form={form} from={tag} size="base" />
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
