import type { TagProperty } from '@reflect/core'

/** One ready-made schema the config dialog can seed an empty tag with. */
export interface TagSchemaPreset {
  id: string
  name: string
  /** The property names, shown as the row's subtitle. */
  summary: string
  properties: TagProperty[]
}

/**
 * Starter schemas for a tag with no type yet (TDR 0005): one click seeds the
 * draft rows — nothing is saved until the user says so, and every property
 * stays editable. Each preset deliberately includes a groupable property
 * (and, where natural, a date), so the board or calendar lights up in the
 * views strip immediately — the fastest honest answer to "how do I get a
 * kanban?". Keys here must stay clear of `RESERVED_FRONTMATTER_KEYS`.
 */
export const TAG_SCHEMA_PRESETS: TagSchemaPreset[] = [
  {
    id: 'tasks',
    name: 'Task board',
    summary: 'Status · Due · Priority',
    properties: [
      {
        name: 'Status',
        key: 'status',
        type: 'status',
        options: ['Backlog', 'In progress', 'Done'],
      },
      { name: 'Due', key: 'due', type: 'date' },
      { name: 'Priority', key: 'priority', type: 'select', options: ['High', 'Medium', 'Low'] },
    ],
  },
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
  {
    id: 'people',
    name: 'People',
    summary: 'Email · Company · Birthday',
    properties: [
      { name: 'Email', key: 'email', type: 'email' },
      { name: 'Company', key: 'company', type: 'text' },
      { name: 'Birthday', key: 'birthday', type: 'date' },
    ],
  },
]
