import type { ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import type { TagConfigDraft } from './use-tag-config-draft'

/**
 * The desktop settings' footer: Save, the key-migration choice a field
 * rename asks for, or the confirmation before closing with unsaved edits.
 */
export function SaveBar({
  config,
  onClose,
  discarding,
  onKeepEditing,
  onDiscard,
}: {
  config: TagConfigDraft
  /** Ask to close: the caller confirms first when there are unsaved edits. */
  onClose: () => void
  /** A close was asked for with unsaved edits: confirm before losing them. */
  discarding: boolean
  onKeepEditing: () => void
  onDiscard: () => void
}): ReactElement {
  const { pendingRenames } = config
  if (discarding) {
    return (
      <footer className="flex items-center gap-2 bg-surface-hover px-5 py-3">
        <p className="min-w-0 flex-1 text-sm text-text">Discard your unsaved changes?</p>
        <Button type="button" variant="ghost" autoFocus onClick={onKeepEditing}>
          Keep editing
        </Button>
        <Button type="button" variant="destructive" onClick={onDiscard}>
          Discard
        </Button>
      </footer>
    )
  }
  if (pendingRenames !== null) {
    return (
      <footer className="flex flex-col gap-2 bg-surface-hover px-5 py-3">
        <p className="text-xs text-text-secondary">
          {pendingRenames
            .map(
              (rename) =>
                `${rename.from} → ${rename.to} (${rename.notes.length} ${
                  rename.notes.length === 1 ? 'note' : 'notes'
                })`,
            )
            .join(' · ')}
          . Move the stored values to the new key, or keep them under the old one?
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={config.cancelPendingRenames}>
            Back
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={config.saving}
            onClick={() => {
              void config.performSave([], false)
            }}
          >
            Save without migrating
          </Button>
          <Button
            type="button"
            disabled={config.saving}
            onClick={() => {
              void config.performSave(pendingRenames, true)
            }}
          >
            Save & migrate values
          </Button>
        </div>
      </footer>
    )
  }
  return (
    <footer className="flex items-center justify-end gap-2 px-5 pb-4 pt-3">
      <Button type="button" variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button
        type="button"
        onClick={() => {
          void config.save()
        }}
        disabled={config.loading || config.saving || config.hasInvalidRows}
      >
        {config.needsConversion ? 'Convert & save' : 'Save'}
      </Button>
    </footer>
  )
}
