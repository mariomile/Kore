import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  foldTag,
  isPropertyKey,
  listNotesWithProperty,
  propertyKeyForName,
  propertyRowValue,
  tagPropertyTypeSchema,
  type CollectionValue,
  type TagProperty,
  type TagPropertyType,
} from '@reflect/core'
import { ArrowDown, ArrowUp, Plus, Trash } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import { commitNoteFrontmatter } from '@/lib/note-frontmatter'
import { readTagDefinition, saveTagType } from '@/lib/tags/tag-type-write'
import { tagTypeQueryKey } from '@/hooks/use-tag-type'
import { useGraph } from '@/providers/graph-provider'

interface TagConfigDialogProps {
  /** The tag being configured (display casing). */
  tag: string
  onClose: () => void
}

/** One schema row under edit; `options` stays comma-text until save. */
interface PropertyDraft {
  rowId: number
  name: string
  key: string
  /** The stored key this row loaded with (null for a new row) — a changed
   * key is a rename, which can migrate the notes' values on save. */
  originalKey: string | null
  type: TagPropertyType
  options: string
}

/** A key rename awaiting the migrate-or-not decision, with its blast radius. */
interface PendingRename {
  from: string
  to: string
  notes: { notePath: string; value: CollectionValue }[]
}

const PROPERTY_TYPE_LABELS: Record<TagPropertyType, string> = {
  text: 'Text',
  number: 'Number',
  checkbox: 'Checkbox',
  date: 'Date',
  select: 'Select',
  multiselect: 'Multi-select',
  url: 'URL',
  relation: 'Relation',
}

const FIELD_LABEL_CLASS = 'text-xs font-medium text-text-secondary'

function draftsFromSchema(properties: readonly TagProperty[]): PropertyDraft[] {
  return properties.map((property, index) => ({
    rowId: index,
    name: property.name,
    key: property.key,
    originalKey: property.key,
    type: property.type,
    options: property.options?.join(', ') ?? '',
  }))
}

function schemaFromDrafts(drafts: readonly PropertyDraft[]): TagProperty[] {
  return drafts.map((draft) => {
    const options = draft.options
      .split(',')
      .map((option) => option.trim())
      .filter((option) => option !== '')
    const hasOptions = draft.type === 'select' || draft.type === 'multiselect'
    return {
      name: draft.name.trim(),
      key: draft.key,
      type: draft.type,
      ...(hasOptions && options.length > 0 ? { options } : {}),
    }
  })
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
  const [saving, setSaving] = useState(false)
  const [pendingRenames, setPendingRenames] = useState<PendingRename[] | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      const definition = await readTagDefinition(tag)
      if (!active) {
        return
      }
      setNeedsConversion(definition.needsConversion)
      const rows = draftsFromSchema(definition.properties)
      setDrafts(rows)
      setNextRowId(rows.length)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [tag])

  const invalidRowIds = useMemo(() => {
    const invalid = new Set<number>()
    const seenKeys = new Set<string>()
    for (const draft of drafts) {
      if (draft.name.trim() === '' || !isPropertyKey(draft.key) || seenKeys.has(draft.key)) {
        invalid.add(draft.rowId)
      }
      seenKeys.add(draft.key)
    }
    return invalid
  }, [drafts])

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
      { rowId: nextRowId, name: '', key: '', originalKey: null, type: 'text', options: '' },
    ])
    setNextRowId((current) => current + 1)
  }

  const performSave = async (renames: PendingRename[], migrate: boolean): Promise<void> => {
    if (graph === null) {
      return
    }
    setSaving(true)
    try {
      await saveTagType(tag, schemaFromDrafts(drafts), graph.generation)
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
    if (graph === null || saving || invalidRowIds.size > 0) {
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
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
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
          {drafts.map((draft) => {
            const invalid = invalidRowIds.has(draft.rowId)
            const hasOptions = draft.type === 'select' || draft.type === 'multiselect'
            return (
              <div
                key={draft.rowId}
                className="flex flex-col gap-1.5 rounded-md border border-border p-2.5"
              >
                <div className="flex items-center gap-1.5">
                  <Input
                    value={draft.name}
                    aria-label="Property name"
                    aria-invalid={invalid || undefined}
                    placeholder="Author"
                    className="flex-1"
                    onChange={(event) => {
                      const name = event.target.value
                      updateDraft(draft.rowId, {
                        name,
                        // Follow the name until the key was edited by hand.
                        ...(draft.key === propertyKeyForName(draft.name)
                          ? { key: propertyKeyForName(name) }
                          : {}),
                      })
                    }}
                  />
                  <Select
                    value={draft.type}
                    items={PROPERTY_TYPE_LABELS}
                    onValueChange={(value) => {
                      const parsed = tagPropertyTypeSchema.safeParse(value)
                      if (parsed.success) {
                        updateDraft(draft.rowId, { type: parsed.data })
                      }
                    }}
                  >
                    <SelectTrigger className="w-32 shrink-0" aria-label="Property type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Move property up"
                    onClick={() => moveDraft(draft.rowId, -1)}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Move property down"
                    onClick={() => moveDraft(draft.rowId, 1)}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove property"
                    onClick={() =>
                      setDrafts((current) => current.filter((row) => row.rowId !== draft.rowId))
                    }
                  >
                    <Trash className="size-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="flex flex-1 items-center gap-1.5">
                    <span className={FIELD_LABEL_CLASS}>Key</span>
                    <Input
                      value={draft.key}
                      aria-label="Frontmatter key"
                      aria-invalid={invalid || undefined}
                      placeholder="author"
                      className="flex-1 font-mono text-xs"
                      onChange={(event) => updateDraft(draft.rowId, { key: event.target.value })}
                    />
                  </label>
                  {hasOptions ? (
                    <label className="flex flex-[2] items-center gap-1.5">
                      <span className={FIELD_LABEL_CLASS}>Options</span>
                      <Input
                        value={draft.options}
                        aria-label="Options (comma-separated)"
                        placeholder="to-read, reading, done"
                        className="flex-1"
                        onChange={(event) =>
                          updateDraft(draft.rowId, { options: event.target.value })
                        }
                      />
                    </label>
                  ) : null}
                </div>
              </div>
            )
          })}
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
              disabled={loading || saving || invalidRowIds.size > 0}
            >
              {needsConversion ? 'Convert & save' : 'Save'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
