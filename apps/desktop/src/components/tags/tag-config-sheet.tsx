import { useRef, useState, type ReactElement, type ReactNode } from 'react'
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { foldTag } from '@kore/core'
import { ChevronLeft, ChevronRight, List, Plus } from '@/components/icons'
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
import { cn } from '@/lib/utils'
import { useRouter } from '@/routing/router'
import { PROPERTY_TYPE_ICONS } from './property-type-icons'
import { PROPERTY_TYPE_LABELS, type PropertyDraft } from './tag-config-drafts'
import { TagIconPicker } from './tag-icon-picker'
import { TagParentsField } from './tag-parents-field'
import { TagPresetIcon } from './tag-preset-icon'
import { TagFieldPage } from './tag-field-page'
import { TagViewsStrip } from './tag-views-strip'
import { useTagConfigDraft, type TagConfigDraft } from './use-tag-config-draft'

interface TagConfigSheetProps {
  /** The tag being configured (display casing). */
  tag: string
  onClose: () => void
}

/** Base UI's drawer leaves a swipe that starts here alone (the drag handle). */
const SWIPE_IGNORE = { 'data-base-ui-swipe-ignore': '' }

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
export function TagConfigSheet({ tag, onClose }: TagConfigSheetProps): ReactElement {
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

  const showNotes = (): void => {
    afterSaveRef.current = () => navigate({ kind: 'allNotes', filter: { kind: 'tag', tag } })
    void config.save()
  }

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DrawerContent className="[--drawer-height:calc(100dvh-3.5rem)]">
        <div className="flex items-center gap-2 border-b border-border px-3 pb-3 pt-1">
          {editing === null ? (
            <Button type="button" variant="ghost" className="h-10 px-3 text-base" onClick={onClose}>
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
            {editing === null ? `#${key}` : editing.name.trim() || 'New field'}
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
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-8 pt-4">
          {editing === null ? (
            <TypePage
              tagKey={key}
              config={config}
              onOpenField={setEditingRowId}
              onShowNotes={showNotes}
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

/** An iOS-style grouped list: a muted caption over a rounded card. */
function Section({
  title,
  children,
  footer,
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
}): ReactElement {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="px-1 text-xs font-medium uppercase tracking-wide text-text-muted">{title}</h3>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">{children}</div>
      {footer === undefined ? null : <div className="px-1 text-xs text-text-muted">{footer}</div>}
    </section>
  )
}

function TypePage({
  tagKey,
  config,
  onOpenField,
  onShowNotes,
}: {
  tagKey: string
  config: TagConfigDraft
  onOpenField: (rowId: number) => void
  onShowNotes: () => void
}): ReactElement {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const { drafts, loading } = config

  return (
    <>
      {config.needsConversion ? (
        <p className="rounded-xl bg-surface-hover px-3 py-2 text-sm text-text-secondary">
          A note already exists at <code className="font-mono text-xs">tags/{tagKey}.md</code>.
          Saving turns it into this type's definition; its text is kept.
        </p>
      ) : null}

      <Section title="Type">
        <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
          <span className="text-base">Icon</span>
          <TagIconPicker value={config.icon} onChange={config.setIcon} />
        </div>
      </Section>

      <Section
        title="Fields"
        footer={drafts.length > 1 ? 'Drag a field by its handle to change the order.' : undefined}
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
                  <FieldRow
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
          <button
            type="button"
            disabled={loading}
            onClick={() => onOpenField(config.addDraft())}
            className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-base text-primary active:bg-surface-hover"
          >
            <Plus aria-hidden className="size-5" />
            Add field
          </button>
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
          <TagParentsField
            tag={tagKey}
            parents={config.parents}
            candidates={config.parentCandidates}
            onChange={config.setParents}
          />
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
        <div className="flex flex-col gap-2 rounded-xl bg-surface-hover p-3">
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

/** One field on the type page: drag handle, glyph, name, type, chevron. */
function FieldRow({
  draft,
  invalid,
  onOpen,
}: {
  draft: PropertyDraft
  invalid: boolean
  onOpen: () => void
}): ReactElement {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: draft.rowId })
  const Glyph = PROPERTY_TYPE_ICONS[draft.type]
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'relative flex min-h-12 items-center border-b border-border bg-surface',
        isDragging && 'z-10 shadow-lg',
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label={`Reorder ${draft.name.trim() || 'field'}`}
        className="flex h-12 w-11 shrink-0 touch-none items-center justify-center text-text-muted"
        {...SWIPE_IGNORE}
        {...attributes}
        {...listeners}
      >
        <List aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-12 min-w-0 flex-1 items-center gap-3 pr-4 text-left active:bg-surface-hover"
      >
        <Glyph aria-hidden className="size-4 shrink-0 text-text-muted" />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-base',
            draft.name.trim() === '' ? 'text-text-muted' : 'text-text',
          )}
        >
          {draft.name.trim() || 'Untitled field'}
        </span>
        {invalid ? (
          <span className="shrink-0 text-xs text-destructive">Needs a name</span>
        ) : (
          <span className="shrink-0 text-sm text-text-muted">
            {PROPERTY_TYPE_LABELS[draft.type]}
          </span>
        )}
        <ChevronRight aria-hidden className="size-4 shrink-0 text-text-muted" />
      </button>
    </li>
  )
}
