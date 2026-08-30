import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  foldTag,
  isPropertyKey,
  listNotesWithProperty,
  listTemplates,
  propertyRowValue,
  type TemplateEntry,
} from '@reflect/core'
import { Book, Calendar, Chart, Folder, Plus, User } from '@/components/icons'
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
import { toast } from '@/components/ui/toast'
import { commitNoteFrontmatter } from '@/lib/note-frontmatter'
import { TAG_SCHEMA_PRESETS, type TagSchemaPreset } from '@/lib/tags/schema-presets'
import { readTagDefinition, saveTagType } from '@/lib/tags/tag-type-write'
import { tagTypeQueryKey } from '@/hooks/use-tag-type'
import { useGraph } from '@/providers/graph-provider'
import {
  FIELD_LABEL_CLASS,
  draftsForNewSchema,
  draftsFromSchema,
  schemaFromDrafts,
  type PendingRename,
  type PropertyDraft,
} from './tag-config-drafts'
import { TagPropertyRow } from './tag-property-row'
import { TagViewsStrip } from './tag-views-strip'

/** The presets' row glyphs (kept here so the preset data stays plain). */
const PRESET_ICONS = {
  project: Folder,
  person: User,
  company: Chart,
  meeting: Calendar,
  reading: Book,
} as const

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
 */
export function TagConfigDialog({ tag, onClose }: TagConfigDialogProps): ReactElement {
  const { graph } = useGraph()
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(true)
  const [needsConversion, setNeedsConversion] = useState(false)
  const [drafts, setDrafts] = useState<PropertyDraft[]>([])
  const [nextRowId, setNextRowId] = useState(0)
  // The row whose name input takes focus — the one "Add property" just made.
  const [focusRowId, setFocusRowId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [pendingRenames, setPendingRenames] = useState<PendingRename[] | null>(null)
  const [template, setTemplate] = useState<string | null>(null)
  const [templates, setTemplates] = useState<TemplateEntry[]>([])

  useEffect(() => {
    let active = true
    void (async () => {
      const definition = await readTagDefinition(tag)
      let available: TemplateEntry[] = []
      try {
        available = await listTemplates()
      } catch {
        available = []
      }
      if (!active) {
        return
      }
      setNeedsConversion(definition.needsConversion)
      const rows = draftsFromSchema(definition.properties)
      setDrafts(rows)
      setNextRowId(rows.length)
      setTemplate(definition.template)
      setTemplates(available)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [tag])

  // Name and key problems are tracked apart: a missing name only marks its
  // input, while a bad or duplicate key must pop the (normally folded) key
  // editor open on its row.
  const { invalidNameRowIds, invalidKeyRowIds } = useMemo(() => {
    const names = new Set<number>()
    const keys = new Set<number>()
    const seenKeys = new Set<string>()
    for (const draft of drafts) {
      if (draft.name.trim() === '') {
        names.add(draft.rowId)
      }
      if (!isPropertyKey(draft.key) || seenKeys.has(draft.key)) {
        keys.add(draft.rowId)
      }
      seenKeys.add(draft.key)
    }
    return { invalidNameRowIds: names, invalidKeyRowIds: keys }
  }, [drafts])
  const hasInvalidRows = invalidNameRowIds.size > 0 || invalidKeyRowIds.size > 0
  // What the drafts unlock, live — the views strip re-renders per keystroke.
  const liveSchema = useMemo(() => schemaFromDrafts(drafts), [drafts])

  const updateDraft = (rowId: number, patch: Partial<PropertyDraft>): void => {
    setDrafts((current) =>
      current.map((draft) => (draft.rowId === rowId ? { ...draft, ...patch } : draft)),
    )
  }

  const moveDraft = (rowId: number, delta: -1 | 1): void => {
    setDrafts((current) => {
      const index = current.findIndex((draft) => draft.rowId === rowId)
      const target = index + delta
      if (index < 0 || target < 0 || target >= current.length) {
        return current
      }
      const next = [...current]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved!)
      return next
    })
  }

  const addDraft = (): void => {
    setDrafts((current) => [
      ...current,
      {
        rowId: nextRowId,
        name: '',
        key: '',
        originalKey: null,
        type: 'text',
        options: '',
        rollupRelation: '',
        rollupProperty: '',
        rollupAggregation: 'count',
      },
    ])
    setFocusRowId(nextRowId)
    setNextRowId((current) => current + 1)
  }

  // One click seeds an empty schema with editable rows — nothing is saved
  // yet, and the views strip lights up to show what the preset unlocked.
  const seedPreset = (preset: TagSchemaPreset): void => {
    const rows = draftsForNewSchema(preset.properties)
    setDrafts(rows)
    setNextRowId(rows.length)
    setFocusRowId(null)
  }

  const performSave = async (renames: PendingRename[], migrate: boolean): Promise<void> => {
    if (graph === null) {
      return
    }
    setSaving(true)
    try {
      await saveTagType(tag, schemaFromDrafts(drafts), graph.generation, template)
      if (migrate) {
        // Move each note's value to the new key through the ordinary patch
        // channel — the same write an inline edit makes, one note at a time.
        for (const rename of renames) {
          for (const note of rename.notes) {
            await commitNoteFrontmatter(
              note.notePath,
              {
                properties: {
                  [rename.from]: undefined,
                  [rename.to]: propertyRowValue(note.value),
                },
              },
              graph.generation,
            )
          }
        }
      }
      await queryClient.invalidateQueries({ queryKey: tagTypeQueryKey(graph.root, tag) })
      onClose()
    } catch (error) {
      toast.add({
        type: 'error',
        title: `Couldn't save the #${tag} type`,
        description: error instanceof Error ? error.message : String(error),
      })
      setSaving(false)
    }
  }

  const save = async (): Promise<void> => {
    if (graph === null || saving || hasInvalidRows) {
      return
    }
    // A changed key on a loaded row is a rename; when notes still carry the
    // old key, saving must not silently orphan their values — surface the
    // blast radius and let the user migrate (or explicitly not).
    const renamed = drafts.filter(
      (draft) => draft.originalKey !== null && draft.originalKey !== draft.key,
    )
    if (renamed.length > 0) {
      const withUses = await Promise.all(
        renamed.map(async (draft) => ({
          from: draft.originalKey!,
          to: draft.key,
          notes: await listNotesWithProperty(draft.originalKey!),
        })),
      )
      const affecting = withUses.filter((rename) => rename.notes.length > 0)
      if (affecting.length > 0) {
        setPendingRenames(affecting)
        return
      }
    }
    await performSave([], false)
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose()
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configure #{foldTag(tag)}</DialogTitle>
          <DialogDescription>
            Properties become columns of the tag's collection and fields on every note carrying the
            tag. They are stored in{' '}
            <code className="font-mono text-xs">tags/{foldTag(tag)}.md</code>, a note that syncs
            with the graph.
          </DialogDescription>
        </DialogHeader>
        {needsConversion ? (
          <p className="rounded-md bg-surface-hover px-3 py-2 text-xs text-text-secondary">
            A note already exists at <code className="font-mono">tags/{foldTag(tag)}.md</code>.
            Saving converts it into this tag's definition (adds the type marker to its frontmatter);
            its body is kept.
          </p>
        ) : null}
        <div className="flex flex-col gap-2" aria-busy={loading || undefined}>
          {!loading && drafts.length === 0 ? (
            <div className="flex flex-col gap-1 rounded-md bg-surface-hover p-2">
              <p className="px-1 pb-1 text-xs text-text-secondary">
                Start from a ready-made schema — every property stays editable:
              </p>
              {TAG_SCHEMA_PRESETS.map((preset) => {
                const Glyph = PRESET_ICONS[preset.id as keyof typeof PRESET_ICONS] ?? Plus
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => seedPreset(preset)}
                    className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-active"
                  >
                    <Glyph aria-hidden className="size-4 shrink-0 text-text-muted" />
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
              onRemove={() =>
                setDrafts((current) => current.filter((row) => row.rowId !== draft.rowId))
              }
            />
          ))}
          <Button
            type="button"
            variant="ghost"
            className="justify-start"
            onClick={addDraft}
            disabled={loading}
          >
            <Plus className="size-4" /> Add property
          </Button>
        </div>
        {loading ? null : <TagViewsStrip properties={liveSchema} />}
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL_CLASS}>New-row template</span>
          <Select
            value={template ?? 'none'}
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
              <Button type="button" variant="ghost" onClick={() => setPendingRenames(null)}>
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
