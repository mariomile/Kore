import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  isPropertyKey,
  listTagParentCandidates,
  listTemplates,
  type TagProperty,
  type TemplateEntry,
} from '@kore/core'
import { toast } from '@/components/ui/toast'
import { tagTypeQueryKey } from '@/hooks/use-tag-type'
import type { TagSchemaPreset } from '@/lib/tags/schema-presets'
import {
  migratePropertyRenames,
  planPropertyRenames,
  type PendingRename,
} from '@/lib/tags/schema-renames'
import { readTagDefinition, saveTagType } from '@/lib/tags/tag-type-write'
import { useGraph } from '@/providers/graph-provider'
import {
  draftsForNewSchema,
  draftsFromSchema,
  schemaFromDrafts,
  type PropertyDraft,
} from './tag-config-drafts'

/** A fresh, empty schema row. */
function blankDraft(rowId: number): PropertyDraft {
  return {
    rowId,
    name: '',
    key: '',
    originalKey: null,
    type: 'text',
    options: '',
    target: '',
    rollupRelation: '',
    rollupProperty: '',
    rollupAggregation: 'count',
    reverseTag: '',
    reverseProperty: '',
    formulaExpression: '',
    startingKind: 'none',
    startingFixed: '',
  }
}

export interface TagConfigDraft {
  loading: boolean
  /** An unmarked note already sits at `tags/<key>.md`; saving converts it. */
  needsConversion: boolean
  drafts: PropertyDraft[]
  /** What the drafts unlock, live (the views strip re-renders per keystroke). */
  liveSchema: TagProperty[]
  invalidNameRowIds: ReadonlySet<number>
  invalidKeyRowIds: ReadonlySet<number>
  hasInvalidRows: boolean
  /** The row whose name input takes focus: the one "Add property" just made. */
  focusRowId: number | null
  icon: string | null
  setIcon: (icon: string | null) => void
  template: string | null
  setTemplate: (template: string | null) => void
  templates: TemplateEntry[]
  parents: string[]
  setParents: (parents: string[]) => void
  parentCandidates: string[]
  updateDraft: (rowId: number, patch: Partial<PropertyDraft>) => void
  moveDraft: (rowId: number, delta: -1 | 1) => void
  /** Move a row to another row's position (a drag reorder). */
  moveDraftTo: (rowId: number, overRowId: number) => void
  /** Add an empty row and return its id. */
  addDraft: () => number
  removeDraft: (rowId: number) => void
  seedPreset: (preset: TagSchemaPreset) => void
  saving: boolean
  /** Renames that still hold values on notes, waiting for migrate-or-keep. */
  pendingRenames: PendingRename[] | null
  cancelPendingRenames: () => void
  /** Save, first stopping on renames that would orphan stored values. */
  save: () => Promise<void>
  /** Save now, migrating the given renames' values when `migrate`. */
  performSave: (renames: PendingRename[], migrate: boolean) => Promise<void>
}

/**
 * The editing state behind a tag's type configuration (TDR 0005): the
 * property drafts, icon, template and parents loaded from `tags/<key>.md`,
 * their validation, and the save with its rename migration. Shared by the
 * desktop dialog and the phone's bottom sheet, so the two surfaces differ
 * only in layout and can never save differently.
 */
export function useTagConfigDraft(tag: string, onSaved: () => void): TagConfigDraft {
  const { graph } = useGraph()
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(true)
  const [needsConversion, setNeedsConversion] = useState(false)
  const [drafts, setDrafts] = useState<PropertyDraft[]>([])
  const [nextRowId, setNextRowId] = useState(0)
  const [focusRowId, setFocusRowId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [pendingRenames, setPendingRenames] = useState<PendingRename[] | null>(null)
  const [template, setTemplate] = useState<string | null>(null)
  const [templates, setTemplates] = useState<TemplateEntry[]>([])
  const [icon, setIcon] = useState<string | null>(null)
  // The tags this one builds on (Plan 33 B2) and the ones it may pick.
  const [parents, setParents] = useState<string[]>([])
  const [parentCandidates, setParentCandidates] = useState<string[]>([])

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
      let candidates: string[] = []
      try {
        candidates = await listTagParentCandidates(tag)
      } catch {
        candidates = []
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
      setIcon(definition.icon)
      setParents(definition.parents)
      setParentCandidates(candidates)
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
  const liveSchema = useMemo(() => schemaFromDrafts(drafts), [drafts])

  const updateDraft = (rowId: number, patch: Partial<PropertyDraft>): void => {
    setDrafts((current) =>
      current.map((draft) => (draft.rowId === rowId ? { ...draft, ...patch } : draft)),
    )
  }

  const moveDraftTo = (rowId: number, overRowId: number): void => {
    setDrafts((current) => {
      const index = current.findIndex((draft) => draft.rowId === rowId)
      const target = current.findIndex((draft) => draft.rowId === overRowId)
      if (index < 0 || target < 0 || index === target) {
        return current
      }
      const next = [...current]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved!)
      return next
    })
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

  const addDraft = (): number => {
    const rowId = nextRowId
    setDrafts((current) => [...current, blankDraft(rowId)])
    setFocusRowId(rowId)
    setNextRowId(rowId + 1)
    return rowId
  }

  const removeDraft = (rowId: number): void => {
    setDrafts((current) => current.filter((row) => row.rowId !== rowId))
  }

  // One gesture seeds an empty schema with editable rows. Nothing is saved
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
      await saveTagType(tag, schemaFromDrafts(drafts), graph.generation, {
        template,
        icon,
        parents,
      })
      if (migrate) {
        await migratePropertyRenames(renames, graph.generation)
      }
      await queryClient.invalidateQueries({ queryKey: tagTypeQueryKey(graph.root, tag) })
      onSaved()
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
    // old key, saving must not silently orphan their values: surface the
    // blast radius and let the user migrate (or explicitly not).
    const affecting = await planPropertyRenames(
      drafts
        .filter((draft) => draft.originalKey !== null && draft.originalKey !== draft.key)
        .map((draft) => ({ from: draft.originalKey!, to: draft.key })),
    )
    if (affecting.length > 0) {
      setPendingRenames(affecting)
      return
    }
    await performSave([], false)
  }

  return {
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
    moveDraftTo,
    addDraft,
    removeDraft,
    seedPreset,
    saving,
    pendingRenames,
    cancelPendingRenames: () => setPendingRenames(null),
    save,
    performSave,
  }
}
