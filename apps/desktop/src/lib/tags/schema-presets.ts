import { DEFAULT_VAULT_OBJECTS, type TagProperty } from '@reflect/core'

/** One ready-made schema the config dialog can seed an empty tag with. */
export interface TagSchemaPreset {
  id: string
  name: string
  /** The property names, shown as the row's subtitle. */
  summary: string
  properties: TagProperty[]
}

function presetFor(tag: string, properties: readonly TagProperty[]): TagSchemaPreset {
  return {
    id: tag.toLowerCase(),
    name: tag,
    summary: properties.map((property) => property.name).join(' · '),
    properties: [...properties],
  }
}

/**
 * Starter schemas for a tag with no type yet (TDR 0005): one click seeds the
 * draft rows — nothing is saved until the user says so, and every property
 * stays editable. The first four are the vault's default objects verbatim
 * (`DEFAULT_VAULT_OBJECTS` is the single source of truth), so a deleted
 * default is always one click from coming back on any tag; Reading list is
 * the one extra. Keys must stay clear of `RESERVED_FRONTMATTER_KEYS`.
 */
export const TAG_SCHEMA_PRESETS: TagSchemaPreset[] = [
  ...DEFAULT_VAULT_OBJECTS.map((object) => presetFor(object.tag, object.properties)),
  {
    id: 'reading',
    name: 'Reading list',
    summary: 'Author · Status · Rating',
    properties: [
      { name: 'Author', key: 'author', type: 'text' },
      { name: 'Status', key: 'status', type: 'status', options: ['To read', 'Reading', 'Done'] },
      { name: 'Rating', key: 'rating', type: 'rating' },
    ],
  },
]
