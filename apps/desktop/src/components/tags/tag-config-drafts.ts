import {
  foldTag,
  startingValueKind,
  startingValueOf,
  isOptionColor,
  type OptionChange,
  type OptionColor,
  type RollupAggregation,
  type StartingValueKind,
  type TagProperty,
  type TagPropertyType,
} from '@kore/core'

/** One select/status option under edit. */
export interface OptionDraft {
  /** Stable row id for React keys and drag-and-drop (unique per property). */
  id: number
  name: string
  /** The text this option loaded with (null for a new one): a changed name
   * is a rename, and saving moves the notes' values to the new text. */
  original: string | null
  /** The picked palette color, or null for the hashed one. */
  color: OptionColor | null
  /**
   * Set once the option was deleted while notes still use it: the row stays
   * in the list, struck through, so the delete can be undone and the notes'
   * fate picked. An option no note uses just leaves the list.
   */
  removal: OptionRemoval | null
}

/** Where a deleted option's notes go on save. */
export interface OptionRemoval {
  /** The option (by id) the notes move to, or null to take the value off them. */
  moveToId: number | null
}

/** One schema row under edit. */
export interface PropertyDraft {
  rowId: number
  name: string
  key: string
  /** The stored key this row loaded with (null for a new row) — a changed
   * key is a rename, which can migrate the notes' values on save. */
  originalKey: string | null
  type: TagPropertyType
  /** Select/status choices in their display order. */
  options: OptionDraft[]
  /** A relation's target tag ('' = any note). */
  target: string
  rollupRelation: string
  rollupProperty: string
  rollupAggregation: RollupAggregation
  /** A reverse relation's linking collection and its relation key. */
  reverseTag: string
  reverseProperty: string
  /** A formula's expression (view-only; empty = not configured). */
  formulaExpression: string
  /** The field's starting value (Plan 33 B4): none, or its kind. */
  startingKind: StartingValueKind | 'none'
  /** A fixed starting value as typed ('' = none yet). */
  startingFixed: string
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
  formula: 'Formula',
  rollup: 'Rollup',
  reverse: 'Reverse relation',
}

/**
 * Labels sit in one fixed column, 32px tall like the controls beside them, so
 * every control in the dialog starts at the same x and a label stays on the
 * first line of a control that wraps (options chips, parents). A property
 * card narrows the column by its own inset (`--field-label-w`), so controls
 * inside a card line up with the dialog's top-level ones.
 */
export const FIELD_LABEL_CLASS =
  'flex h-8 w-(--field-label-w,7rem) shrink-0 items-center text-xs font-medium text-text-secondary'

export function draftsFromSchema(properties: readonly TagProperty[]): PropertyDraft[] {
  return properties.map((property, index) => ({
    rowId: index,
    name: property.name,
    key: property.key,
    originalKey: property.key,
    type: property.type,
    options: optionDraftsFrom(property),
    target: property.target ?? '',
    rollupRelation: property.rollup?.relation ?? '',
    rollupProperty: property.rollup?.property ?? '',
    rollupAggregation: property.rollup?.aggregation ?? 'count',
    reverseTag: property.reverse?.tag ?? '',
    reverseProperty: property.reverse?.property ?? '',
    formulaExpression: property.formula?.expression ?? '',
    startingKind: property.default === undefined ? 'none' : startingValueKind(property.default),
    startingFixed:
      property.default !== undefined && startingValueKind(property.default) === 'fixed'
        ? String(property.default)
        : '',
  }))
}

/** Option drafts for a stored property: its options in order, each with
 * the color the definition picked (unknown color names read as none). */
export function optionDraftsFrom(property: Pick<TagProperty, 'options' | 'colors'>): OptionDraft[] {
  return (property.options ?? []).map((name, id) => {
    const color = property.colors?.[name]
    return {
      id,
      name,
      original: name,
      color: isOptionColor(color) ? color : null,
      removal: null,
    }
  })
}

/** The options still in the list: the ones not deleted. */
export function keptOptions(options: readonly OptionDraft[]): OptionDraft[] {
  return options.filter((option) => option.removal === null)
}

/**
 * The option a deleted one's notes end up on: the picked target while it is
 * itself still in the list with a name, otherwise none (the value comes off
 * the notes).
 */
function removalTarget(option: OptionDraft, options: readonly OptionDraft[]): OptionDraft | null {
  const moveToId = option.removal?.moveToId ?? null
  const target = moveToId === null ? undefined : options.find((entry) => entry.id === moveToId)
  return target === undefined || target.removal !== null || target.name.trim() === ''
    ? null
    : target
}

/**
 * The options after deleting `id`. A stored option some note still uses
 * (`inUse`) stays as a struck-through row waiting for its notes' fate; any
 * other just leaves, and whatever was moving into it falls back to "remove".
 */
export function removeOption(
  options: readonly OptionDraft[],
  id: number,
  inUse: boolean,
): OptionDraft[] {
  const retargeted = options.map((option) =>
    option.removal?.moveToId === id ? { ...option, removal: { moveToId: null } } : option,
  )
  return inUse
    ? retargeted.map((option) =>
        option.id === id ? { ...option, removal: { moveToId: null } } : option,
      )
    : retargeted.filter((option) => option.id !== id)
}

/**
 * The draft patch for a new options list. A fixed starting value that named
 * an option follows that option: its rename ("Todo" to "To do"), or the
 * option its notes move to when it is deleted, instead of silently dropping.
 */
export function optionsPatch(
  draft: Pick<PropertyDraft, 'options' | 'startingKind' | 'startingFixed'>,
  options: OptionDraft[],
): Partial<PropertyDraft> {
  if (draft.startingKind !== 'fixed') {
    return { options }
  }
  const before = keptOptions(draft.options).find(
    (option) => option.name.trim() === draft.startingFixed.trim(),
  )
  const after = before === undefined ? undefined : options.find((option) => option.id === before.id)
  const follows =
    after === undefined || after.removal === null ? after : removalTarget(after, options)
  return follows === undefined || follows === null || follows.name.trim() === ''
    ? { options }
    : { options, startingFixed: follows.name.trim() }
}

/** The option texts a draft will store: trimmed, blanks, repeats and deleted ones dropped. */
export function draftOptionNames(draft: Pick<PropertyDraft, 'options'>): string[] {
  const names: string[] = []
  for (const option of keptOptions(draft.options)) {
    const name = option.name.trim()
    if (name !== '' && !names.includes(name)) {
      names.push(name)
    }
  }
  return names
}

/**
 * What a save does to the notes' option values: loaded options whose text
 * changed (a rename, or a merge when the new text is another option's), and
 * deleted ones, which move to the picked option or come off the notes
 * (`to: null`). They land together (`optionRenameMap`), so swapping two
 * names swaps the values too.
 */
export function draftOptionChanges(draft: Pick<PropertyDraft, 'options'>): OptionChange[] {
  const changes: OptionChange[] = []
  for (const option of draft.options) {
    if (option.original === null) {
      continue
    }
    if (option.removal !== null) {
      changes.push({
        from: option.original,
        to: removalTarget(option, draft.options)?.name.trim() ?? null,
      })
      continue
    }
    const to = option.name.trim()
    if (to !== '' && to !== option.original) {
      changes.push({ from: option.original, to })
    }
  }
  return changes
}

/**
 * A draft's starting value as the definition stores it, or `undefined` for
 * none. Core decides what is valid (`startingValueOf`), so a value the type
 * can't hold, or a kind left over from a changed type, is dropped here the
 * same way a note never gets it.
 */
export function draftStartingValue(
  draft: PropertyDraft,
  options: readonly string[],
): string | number | boolean | undefined {
  const declared = draft.startingKind === 'fixed' ? draft.startingFixed.trim() : draft.startingKind
  if (declared === 'none' || declared === '') {
    return undefined
  }
  const start = startingValueOf({
    name: draft.name,
    key: draft.key,
    type: draft.type,
    options: [...options],
    default: declared,
  })
  if (start === null) {
    return undefined
  }
  // A fixed value is stored as its type holds it (`3`, `true`); a
  // multiselect's single option stays the option text.
  return start.kind === 'fixed' && !Array.isArray(start.value) ? start.value : declared
}

/** Draft rows for properties that were never stored (a preset seeding an
 * empty schema): same shape, but `originalKey` stays null so saving them is
 * a plain create, never a rename with a migration prompt. */
export function draftsForNewSchema(properties: readonly TagProperty[]): PropertyDraft[] {
  return draftsFromSchema(properties).map((draft) => ({
    ...draft,
    originalKey: null,
  }))
}

export function schemaFromDrafts(drafts: readonly PropertyDraft[]): TagProperty[] {
  return drafts.map((draft) => {
    const options = draftOptionNames(draft)
    const hasOptions =
      draft.type === 'select' || draft.type === 'multiselect' || draft.type === 'status'
    const hasTarget =
      (draft.type === 'relation' || draft.type === 'relations' || draft.type === 'person') &&
      draft.target.trim() !== ''
    const reverse =
      draft.type === 'reverse' &&
      draft.reverseTag.trim() !== '' &&
      draft.reverseProperty.trim() !== ''
        ? {
            tag: draft.reverseTag.trim(),
            property: draft.reverseProperty.trim(),
          }
        : undefined
    const formula =
      draft.type === 'formula' && draft.formulaExpression.trim() !== ''
        ? { expression: draft.formulaExpression.trim() }
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
    const startingValue = draftStartingValue(draft, options)
    const colors: Record<string, OptionColor> = {}
    for (const option of keptOptions(draft.options)) {
      const name = option.name.trim()
      if (option.color !== null && options.includes(name) && !(name in colors)) {
        colors[name] = option.color
      }
    }
    return {
      name: draft.name.trim(),
      key: draft.key,
      type: draft.type,
      ...(hasOptions && options.length > 0 ? { options } : {}),
      ...(hasOptions && Object.keys(colors).length > 0 ? { colors } : {}),
      ...(hasTarget ? { target: draft.target.trim() } : {}),
      ...(rollup === undefined ? {} : { rollup }),
      ...(reverse === undefined ? {} : { reverse }),
      ...(formula === undefined ? {} : { formula }),
      ...(startingValue === undefined ? {} : { default: startingValue }),
    }
  })
}

/** One tag a relation (or reverse) can point at. `key` is folded; `label` is display casing. */
export interface RelationTargetTag {
  key: string
  label: string
}

/**
 * Tags a relation can target: every tag on notes (the sidebar list) plus
 * typed collections that don't have rows yet. Display casing prefers the
 * spelling notes actually use.
 */
export function relationTargetTags(
  noteTags: readonly { tag: string }[],
  typedKeys: readonly string[],
): RelationTargetTag[] {
  const labels = new Map<string, string>()
  for (const key of typedKeys) {
    if (key !== '') {
      labels.set(key, key)
    }
  }
  for (const { tag } of noteTags) {
    const key = foldTag(tag)
    if (key !== '') {
      labels.set(key, tag)
    }
  }
  const tags: RelationTargetTag[] = []
  for (const [key, label] of labels) {
    tags.push({ key, label })
  }
  tags.sort((left, right) => left.key.localeCompare(right.key))
  return tags
}

/**
 * Labels for the relation Target / reverse Of select. A stored key that is
 * no longer in {@link tags} still appears so opening the dialog cannot drop
 * it; a key that is present keeps the notes’ preferred casing.
 */
export function relationTargetSelectItems(
  tags: readonly RelationTargetTag[],
  storedKey: string,
): Record<string, string> {
  const items: Record<string, string> = {}
  for (const tag of tags) {
    items[tag.key] = `#${tag.label}`
  }
  if (storedKey !== '' && !(storedKey in items)) {
    items[storedKey] = `#${storedKey}`
  }
  return items
}
