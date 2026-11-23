import { useEffect, useRef, useState, type ReactElement } from 'react'
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { foldTag, tagDisplayName } from '@kore/core'
import { ChevronLeft, ChevronRight, Info, Plus } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TAG_SCHEMA_PRESETS } from '@/lib/tags/schema-presets'
import { useRouter } from '@/routing/router'
import { TagIconPicker } from './tag-icon-picker'
import { TagFolderField } from './tag-folder-field'
import { TagAdvancedSection } from './tag-parents-field'
import { TagPresetIcon } from './tag-preset-icon'
import { RemovedPropertyNotice } from './removed-property-notice'
import { TagConfigFieldRow } from './tag-config-field-row'
import { TagSheetSection as Section } from './tag-sheet-section'
import { TagSuggestRow } from './tag-suggest-row'
import { useSuggestTagSchema } from './use-suggest-tag-schema'
import { TagFieldPage } from './tag-field-page'
import { TagViewsStrip } from './tag-views-strip'
import { useDiscardGuard, type DiscardGuard } from './use-discard-guard'
import { useTagConfigDraft, type TagConfigDraft } from './use-tag-config-draft'
import { useTypeTagBinding } from './use-type-tag-binding'

interface TagConfigSheetProps {
  /** The tag being configured (display casing). */
  tag: string
  onClose: () => void
  /** Open the rename for the tag being configured. */
  onRename: () => void
  /** A rebind moved the type onto another tag. */
  onRebound: (tag: string) => void
}

/**
 * A type's configuration on the phone: the same drafts and save as the
 * desktop dialog ({@link useTagConfigDraft}), laid out as a tall bottom
 * sheet with two pages. The type page lists the fields as rows (drag the
 * handle to reorder, tap to open), with the icon, the tags it builds on, the
 * views the fields unlock and the template. The field page edits one field:
 * its name, its type from a grid of large targets, and the type's own
 * settings. Nothing is written until Save, and dismissing the sheet discards
 * the edits, like closing the desktop dialog.
 */
export function TagConfigSheet({
  tag,
  onClose,
  onRename,
  onRebound,
}: TagConfigSheetProps): ReactElement {
  const { navigate } = useRouter()
  // Set by "Show notes": after the save lands, open the type's notes.
  const afterSaveRef = useRef<(() => void) | null>(null)
  const config = useTagConfigDraft(tag, () => {
    onClose()
    afterSaveRef.current?.()
  })
  const [editingRowId, setEditingRowId] = useState<number | null>(null)
  const editing = config.drafts.find((draft) => draft.rowId === editingRowId) ?? null
  const key = foldTag(tag)
  // A close asked for with unsaved edits: the header confirms before losing them.
  const { discarding, requestClose, closeThen, keepEditing, discard } = useDiscardGuard(
    config.dirty,
    onClose,
  )

  const showNotes = (): void => {
    afterSaveRef.current = () => navigate({ kind: 'allNotes', filter: { kind: 'tag', tag } })
    void config.save()
  }

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
    >
      <DrawerContent className="[--drawer-height:calc(100dvh-3.5rem)]">
        {discarding ? (
          <div className="flex items-center gap-2 border-b border-border px-3 pb-3 pt-1">
            <Button
              type="button"
              variant="ghost"
              className="h-10 px-3 text-base"
              onClick={keepEditing}
            >
              Keep editing
            </Button>
            <DrawerTitle className="min-w-0 flex-1 truncate px-0 pt-0 text-center text-base font-semibold">
              Discard edits?
            </DrawerTitle>
            <Button
              type="button"
              variant="destructive"
              className="h-10 px-4 text-base"
              onClick={discard}
            >
              Discard
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 border-b border-border px-3 pb-3 pt-1">
            {editing === null ? (
              <Button
                type="button"
                variant="ghost"
                className="h-10 px-3 text-base"
                onClick={requestClose}
              >
                Cancel
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="h-10 gap-1 px-2 text-base"
                onClick={() => setEditingRowId(null)}
              >
                <ChevronLeft aria-hidden className="size-5" />
                Fields
              </Button>
            )}
            <DrawerTitle className="min-w-0 flex-1 truncate px-0 pt-0 text-center text-base font-semibold">
              {editing === null
                ? tagDisplayName(key.slice(key.lastIndexOf('/') + 1))
                : editing.name.trim() || 'New field'}
            </DrawerTitle>
            {editing === null ? (
              <Button
                type="button"
                className="h-10 px-4 text-base"
                disabled={config.loading || config.saving || config.hasInvalidRows}
                onClick={() => {
                  void config.save()
                }}
              >
                {config.needsConversion ? 'Convert' : 'Save'}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="h-10 px-3 text-base font-semibold"
                onClick={() => setEditingRowId(null)}
              >
                Done
              </Button>
            )}
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-8 pt-4">
          {editing === null ? (
            <TypePage
              tagKey={key}
              tag={tag}
              onRebound={onRebound}
              onRename={onRename}
              config={config}
              onOpenField={setEditingRowId}
              onShowNotes={showNotes}
              closeThen={closeThen}
            />
          ) : (
            <TagFieldPage
              draft={editing}
              config={config}
              onRemove={() => {
                config.removeDraft(editing.rowId)
                setEditingRowId(null)
              }}
            />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function TypePage({
  tagKey,
  tag,
  onRebound,
  onRename,
  config,
  onOpenField,
  onShowNotes,
  closeThen,
}: {
  tagKey: string
  tag: string
  onRebound: (tag: string) => void
  onRename: () => void
  config: TagConfigDraft
  onOpenField: (rowId: number) => void
  onShowNotes: () => void
  closeThen: DiscardGuard['closeThen']
}): ReactElement {
  const suggestWithAi = useSuggestTagSchema(tagKey, closeThen)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const { drafts, loading } = config
  const binding = useTypeTagBinding(tag)
  // The migrate-or-keep choice sits at the end of the page while Save is in
  // the header: bring it into view when it appears.
  const pendingRef = useRef<HTMLDivElement>(null)
  const hasPendingRenames = config.pendingRenames !== null
  useEffect(() => {
    if (hasPendingRenames) {
      pendingRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [hasPendingRenames])

  return (
    <>
      {binding.suggestion !== null && !loading ? (
        <div className="flex flex-col gap-3 rounded-xl bg-accent-soft p-3">
          <p className="flex gap-2 text-sm text-accent-soft-text">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="font-medium">
                {binding.suggestion.count} notes use #{binding.suggestion.tag}.
              </span>{' '}
              Bind this tag to that tag so they show up as its rows. Their folders stay as they are.
            </span>
          </p>
          <Button
            type="button"
            className="h-11 text-base"
            disabled={config.saving || config.hasInvalidRows}
            onClick={() => {
              const next = binding.suggestion?.tag
              if (next === undefined) {
                return
              }
              void config.rebindTo(next).then((moved) => {
                if (moved) onRebound(next)
              })
            }}
          >
            Use #{binding.suggestion.tag}
          </Button>
        </div>
      ) : null}
      <p className="-mb-3 px-1 text-xs text-text-muted">
        #{tagKey}
        {binding.count === null
          ? ''
          : ` · ${binding.count} ${binding.count === 1 ? 'note' : 'notes'}`}
      </p>
      {config.needsConversion ? (
        <p className="rounded-xl bg-surface-hover px-3 py-2 text-sm text-text-secondary">
          A note already exists at <code className="font-mono text-xs">tags/{tagKey}.md</code>.
          Saving turns it into this tag's definition; its text is kept.
        </p>
      ) : null}

      <Section title="Tag">
        <button
          type="button"
          onClick={onRename}
          className="flex min-h-12 w-full items-center gap-3 border-b border-border px-4 py-2 text-left active:bg-surface-hover"
        >
          <span className="flex-1 text-base">Name</span>
          <span className="min-w-0 truncate text-base text-text-muted">#{tagKey}</span>
          <ChevronRight aria-hidden className="size-5 shrink-0 text-text-muted" />
        </button>
        <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
          <span className="text-base">Icon</span>
          <TagIconPicker value={config.icon} onChange={config.setIcon} />
        </div>
      </Section>

      <Section
        title="Properties"
        footer={
          drafts.length > 1 ? 'Drag a property by its handle to change the order.' : undefined
        }
      >
        <div aria-busy={loading || undefined}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => {
              if (event.over !== null && event.over.id !== event.active.id) {
                config.moveDraftTo(Number(event.active.id), Number(event.over.id))
              }
            }}
          >
            <SortableContext
              items={drafts.map((draft) => draft.rowId)}
              strategy={verticalListSortingStrategy}
            >
              <ul>
                {drafts.map((draft) => (
                  <TagConfigFieldRow
                    key={draft.rowId}
                    draft={draft}
                    invalid={
                      config.invalidNameRowIds.has(draft.rowId) ||
                      config.invalidKeyRowIds.has(draft.rowId)
                    }
                    onOpen={() => onOpenField(draft.rowId)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          {config.removedDraft === null ? null : (
            <RemovedPropertyNotice
              name={config.removedDraft.name.trim()}
              className="h-12 border-b border-border pl-4 pr-2 text-base"
              onUndo={() => config.restoreRemovedDraft()}
            />
          )}
          <button
            type="button"
            disabled={loading}
            onClick={() => onOpenField(config.addDraft())}
            className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-base text-primary active:bg-surface-hover"
          >
            <Plus aria-hidden className="size-5" />
            Add property
          </button>
          {!loading && drafts.length === 0 && suggestWithAi !== null ? (
            <TagSuggestRow variant="sheet" onSuggest={suggestWithAi} />
          ) : null}
        </div>
      </Section>

      {!loading && drafts.length === 0 ? (
        <Section title="Or start from a template">
          <ul>
            {TAG_SCHEMA_PRESETS.map((preset) => {
              return (
                <li key={preset.id} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => config.seedPreset(preset)}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left active:bg-surface-hover"
                  >
                    <TagPresetIcon
                      presetId={preset.id}
                      className="size-5 shrink-0 text-text-muted"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-base text-text">{preset.name}</span>
                      <span className="truncate text-xs text-text-muted">{preset.summary}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Section>
      ) : null}

      {loading ? null : (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 [--field-label-w:6rem]">
          <TagViewsStrip properties={config.liveSchema} />
          <label className="flex items-center gap-2">
            <span className="flex h-8 w-24 shrink-0 items-center text-xs font-medium text-text-secondary">
              Template
            </span>
            <Select
              value={config.template ?? 'none'}
              items={{
                none: 'None',
                ...Object.fromEntries(config.templates.map((entry) => [entry.path, entry.title])),
              }}
              onValueChange={(value) => config.setTemplate(value === 'none' ? null : value)}
            >
              <SelectTrigger aria-label="New-row template" className="min-w-0 flex-1">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {config.templates.map((entry) => (
                  <SelectItem key={entry.path} value={entry.path}>
                    {entry.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <TagFolderField
            folder={config.folder}
            folders={config.folders}
            onChange={config.setFolder}
            labelClassName="flex h-8 w-24 shrink-0 items-center text-xs font-medium text-text-secondary"
            triggerClassName="min-w-0 flex-1"
          />
          <TagAdvancedSection
            tag={tagKey}
            parents={config.parents}
            candidates={config.parentCandidates}
            onChange={config.setParents}
            className="border-t border-border/60 pt-2"
          />
        </div>
      )}

      <Section title="Notes">
        <button
          type="button"
          disabled={loading || config.saving || config.hasInvalidRows}
          onClick={onShowNotes}
          className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-base active:bg-surface-hover disabled:opacity-50"
        >
          <span>Save and show #{tagKey} notes</span>
          <ChevronRight aria-hidden className="size-4 text-text-muted" />
        </button>
      </Section>

      {config.pendingRenames !== null ? (
        <div ref={pendingRef} className="flex flex-col gap-2 rounded-xl bg-surface-hover p-3">
          <p className="text-sm text-text-secondary">
            {config.pendingRenames
              .map(
                (rename) =>
                  `${rename.from} → ${rename.to} (${rename.notes.length} ${
                    rename.notes.length === 1 ? 'note' : 'notes'
                  })`,
              )
              .join(' · ')}
            . Move the stored values to the new name, or keep them under the old one?
          </p>
          <Button
            type="button"
            className="h-11 text-base"
            disabled={config.saving}
            onClick={() => {
              void config.performSave(config.pendingRenames ?? [], true)
            }}
          >
            Save and move values
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-11 text-base"
            disabled={config.saving}
            onClick={() => {
              void config.performSave([], false)
            }}
          >
            Save without moving
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-11 text-base"
            onClick={config.cancelPendingRenames}
          >
            Back
          </Button>
        </div>
      ) : null}
    </>
  )
}
