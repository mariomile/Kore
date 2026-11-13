import type { ReactElement } from 'react'
import { foldTag } from '@kore/core'
import { Plus } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isMobileSurface } from '@/lib/platform-surface'
import { TAG_SCHEMA_PRESETS } from '@/lib/tags/schema-presets'
import { FIELD_LABEL_CLASS } from './tag-config-drafts'
import { TagConfigSheet } from './tag-config-sheet'
import { TagPresetIcon } from './tag-preset-icon'
import { TagParentsField } from './tag-parents-field'
import { TagIconPicker } from './tag-icon-picker'
import { TagPropertyRow } from './tag-property-row'
import { TagViewsStrip } from './tag-views-strip'
import { useTagConfigDraft } from './use-tag-config-draft'

interface TagConfigDialogProps {
  /** The tag being configured (display casing). */
  tag: string
  onClose: () => void
}

/**
 * The per-tag type configuration (TDR 0005): the property list stored in the
 * tag's definition note (`tags/<key>.md`). Creates the definition on first
 * save; an existing unmarked note at that path is only written after the
 * explicit conversion notice below. A broken-YAML definition refuses the
 * write (`upsertFrontmatter`) and surfaces as a toast — never destroys.
 *
 * On the phone every entry point opens the same configuration as a bottom
 * sheet ({@link TagConfigSheet}) instead: a centered dialog this dense does
 * not fit a 390pt screen.
 */
export function TagConfigDialog(props: TagConfigDialogProps): ReactElement {
  return isMobileSurface() ? <TagConfigSheet {...props} /> : <TagConfigDesktopDialog {...props} />
}

function TagConfigDesktopDialog({ tag, onClose }: TagConfigDialogProps): ReactElement {
  const config = useTagConfigDraft(tag, onClose)
  const {
    loading,
    needsConversion,
    drafts,
    liveSchema,
    invalidNameRowIds,
    invalidKeyRowIds,
    hasInvalidRows,
    focusRowId,
    icon,
    setIcon,
    template,
    setTemplate,
    templates,
    parents,
    setParents,
    parentCandidates,
    updateDraft,
    moveDraft,
    addDraft,
    removeDraft,
    seedPreset,
    saving,
    pendingRenames,
    save,
    performSave,
  } = config

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose()
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[min(48rem,92vw)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configure #{foldTag(tag)}</DialogTitle>
          <DialogDescription>
            Properties become columns of the type's collection and fields on every note of this
            type. They are stored in{' '}
            <code className="font-mono text-xs">tags/{foldTag(tag)}.md</code>, a note that syncs
            with the vault.
          </DialogDescription>
        </DialogHeader>
        {needsConversion ? (
          <p className="rounded-md bg-surface-hover px-3 py-2 text-xs text-text-secondary">
            A note already exists at <code className="font-mono">tags/{foldTag(tag)}.md</code>.
            Saving converts it into this type's definition (adds the type marker to its
            frontmatter); its body is kept.
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <span className={FIELD_LABEL_CLASS}>Icon</span>
          <TagIconPicker value={icon} onChange={setIcon} />
        </div>
        <TagParentsField
          tag={foldTag(tag)}
          parents={parents}
          candidates={parentCandidates}
          onChange={setParents}
        />
        <div className="flex flex-col gap-2" aria-busy={loading || undefined}>
          {!loading && drafts.length === 0 ? (
            <div className="flex flex-col gap-1 rounded-md bg-surface-hover p-2">
              <p className="px-1 pb-1 text-xs text-text-secondary">
                Start from a ready-made schema — every property stays editable:
              </p>
              {TAG_SCHEMA_PRESETS.map((preset) => {
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => seedPreset(preset)}
                    className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-active"
                  >
                    <TagPresetIcon
                      presetId={preset.id}
                      className="size-4 shrink-0 text-text-muted"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-sm font-medium text-text">{preset.name}</span>
                      <span className="truncate text-xs text-text-muted">{preset.summary}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}
          {drafts.map((draft) => (
            <TagPropertyRow
              key={draft.rowId}
              draft={draft}
              nameInvalid={invalidNameRowIds.has(draft.rowId)}
              keyInvalid={invalidKeyRowIds.has(draft.rowId)}
              autoFocus={draft.rowId === focusRowId}
              updateDraft={updateDraft}
              moveDraft={moveDraft}
              onRemove={() => removeDraft(draft.rowId)}
            />
          ))}
          <Button
            type="button"
            variant="ghost"
            className="justify-start"
            onClick={() => {
              addDraft()
            }}
            disabled={loading}
          >
            <Plus className="size-4" /> Add property
          </Button>
        </div>
        {loading ? null : <TagViewsStrip properties={liveSchema} />}
        <label className="flex items-center gap-2">
          <span className={FIELD_LABEL_CLASS}>Template</span>
          <Select
            value={template ?? 'none'}
            items={{
              none: 'None',
              ...Object.fromEntries(templates.map((entry) => [entry.path, entry.title])),
            }}
            onValueChange={(value) => setTemplate(value === 'none' ? null : value)}
          >
            <SelectTrigger aria-label="New-row template">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {templates.map((entry) => (
                <SelectItem key={entry.path} value={entry.path}>
                  {entry.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {pendingRenames !== null ? (
          <div className="flex flex-col gap-2 rounded-md bg-surface-hover px-3 py-2">
            <p className="text-xs text-text-secondary">
              {pendingRenames
                .map(
                  (rename) =>
                    `${rename.from} → ${rename.to} (${rename.notes.length} ${
                      rename.notes.length === 1 ? 'note' : 'notes'
                    })`,
                )
                .join(' · ')}
              {' — '}migrate the stored values to the new key, or keep them under the old one?
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={config.cancelPendingRenames}>
                Back
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  void performSave([], false)
                }}
              >
                Save without migrating
              </Button>
              <Button
                type="button"
                disabled={saving}
                onClick={() => {
                  void performSave(pendingRenames, true)
                }}
              >
                Save & migrate values
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void save()
              }}
              disabled={loading || saving || hasInvalidRows}
            >
              {needsConversion ? 'Convert & save' : 'Save'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
