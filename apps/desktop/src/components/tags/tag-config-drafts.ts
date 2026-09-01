import type {
  CollectionValue,
  RollupAggregation,
  TagProperty,
  TagPropertyType,
} from '@reflect/core'

/** One schema row under edit; `options` stays comma-text until save. */
export interface PropertyDraft {
  rowId: number
  name: string
  key: string
  /** The stored key this row loaded with (null for a new row) — a changed
   * key is a rename, which can migrate the notes' values on save. */
  originalKey: string | null
  type: TagPropertyType
  options: string
  /** A relation's target tag ('' = any note). */
  target: string
  rollupRelation: string
  rollupProperty: string
  rollupAggregation: RollupAggregation
  /** A reverse relation's linking collection and its relation key. */
  reverseTag: string
  reverseProperty: string
}

/** A key rename awaiting the migrate-or-not decision, with its blast radius. */
export interface PendingRename {
  from: string
  to: string
  notes: { notePath: string; value: CollectionValue }[]
}

export const PROPERTY_TYPE_LABELS: Record<TagPropertyType, string> = {
  text: 'Text',
  number: 'Number',
  checkbox: 'Checkbox',
  date: 'Date',
  created: 'Created',
  updated: 'Updated',
  select: 'Select',
  multiselect: 'Multi-select',
  url: 'URL',
  relation: 'Relation',
  relations: 'Multi-relation',
  person: 'Person',
  status: 'Status',
  files: 'Files',
  email: 'Email',
  phone: 'Phone',
  rating: 'Rating',
  rollup: 'Rollup',
  reverse: 'Reverse relation',
}

export const FIELD_LABEL_CLASS = 'text-xs font-medium text-text-secondary'

export function draftsFromSchema(properties: readonly TagProperty[]): PropertyDraft[] {
  return properties.map((property, index) => ({
    rowId: index,
    name: property.name,
    key: property.key,
    originalKey: property.key,
    type: property.type,
    options: property.options?.join(', ') ?? '',
    target: property.target ?? '',
    rollupRelation: property.rollup?.relation ?? '',
    rollupProperty: property.rollup?.property ?? '',
    rollupAggregation: property.rollup?.aggregation ?? 'count',
    reverseTag: property.reverse?.tag ?? '',
    reverseProperty: property.reverse?.property ?? '',
  }))
}

/** Draft rows for properties that were never stored (a preset seeding an
 * empty schema): same shape, but `originalKey` stays null so saving them is
 * a plain create, never a rename with a migration prompt. */
export function draftsForNewSchema(properties: readonly TagProperty[]): PropertyDraft[] {
  return draftsFromSchema(properties).map((draft) => ({ ...draft, originalKey: null }))
}

export function schemaFromDrafts(drafts: readonly PropertyDraft[]): TagProperty[] {
  return drafts.map((draft) => {
    const options = draft.options
      .split(',')
      .map((option) => option.trim())
      .filter((option) => option !== '')
    const hasOptions =
      draft.type === 'select' || draft.type === 'multiselect' || draft.type === 'status'
    const hasTarget =
      (draft.type === 'relation' || draft.type === 'relations') && draft.target.trim() !== ''
    const reverse =
      draft.type === 'reverse' &&
      draft.reverseTag.trim() !== '' &&
      draft.reverseProperty.trim() !== ''
        ? { tag: draft.reverseTag.trim(), property: draft.reverseProperty.trim() }
        : undefined
    const rollup =
      draft.type === 'rollup' &&
      draft.rollupRelation.trim() !== '' &&
      draft.rollupProperty.trim() !== ''
        ? {
            relation: draft.rollupRelation.trim(),
            property: draft.rollupProperty.trim(),
            aggregation: draft.rollupAggregation,
          }
        : undefined
    return {
      name: draft.name.trim(),
      key: draft.key,
      type: draft.type,
      ...(hasOptions && options.length > 0 ? { options } : {}),
      ...(hasTarget ? { target: draft.target.trim() } : {}),
      ...(rollup === undefined ? {} : { rollup }),
      ...(reverse === undefined ? {} : { reverse }),
    }
  })
}
