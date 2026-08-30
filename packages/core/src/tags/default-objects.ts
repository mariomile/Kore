import { createNoteIfAbsent } from '../graph/commands'
import { upsertFrontmatter } from '../markdown'
import { TAG_TYPE_MARKER, tagDefinitionPath, type TagProperty } from './tag-type'

/**
 * The default objects a brand-new vault is born with (TDR 0005): a small set
 * of typed supertags — Project, Person, Company, Meeting — whose definition
 * notes are seeded under `tags/` alongside the welcome note. They are
 * ordinary markdown the user owns: rename them, change their schemas, or
 * delete them, and nothing brings them back — the first-run seed (the app's
 * `ensureFirstRunSeeds`, same marker mechanism as the welcome note) considers
 * each graph exactly once and only writes into a completely empty vault. Per
 * the automations principle, these are content, not behavior: nothing runs
 * because they exist.
 */
export interface DefaultVaultObject {
  /** Display casing of the tag — also the definition note's H1. */
  tag: string
  properties: TagProperty[]
  /** A short body under the H1 explaining how the object is used. */
  body: string
}

export const DEFAULT_VAULT_OBJECTS: DefaultVaultObject[] = [
  {
    tag: 'Project',
    properties: [
      {
        name: 'Status',
        key: 'status',
        type: 'status',
        options: ['Planned', 'Active', 'On hold', 'Done'],
      },
      { name: 'Due', key: 'due', type: 'date' },
      { name: 'Priority', key: 'priority', type: 'select', options: ['High', 'Medium', 'Low'] },
    ],
    body: [
      'Tag a note with `#project` and it joins this collection — one note per',
      'project, with the fields above. The tag page shows them as a table,',
      'board, or calendar.',
      '',
      'A task anywhere whose line links a project belongs to it:',
      '',
      '+ [ ] call the surveyor [[House move]]',
      '',
      "captured in a daily note, it shows up on that project's page, and the",
      "board shows each project's open-task count.",
    ].join('\n'),
  },
  {
    tag: 'Person',
    properties: [
      { name: 'Email', key: 'email', type: 'email' },
      { name: 'Company', key: 'company', type: 'relation' },
      { name: 'Birthday', key: 'birthday', type: 'date' },
      { name: 'Phone', key: 'phone', type: 'text' },
    ],
    body: [
      'Tag a note with `#person` to keep people as notes. The Company field',
      'links a `[[company]]` note, and mentions across the vault collect on',
      "each person's page through backlinks.",
    ].join('\n'),
  },
  {
    tag: 'Company',
    properties: [
      { name: 'Website', key: 'website', type: 'url' },
      { name: 'Industry', key: 'industry', type: 'text' },
      { name: 'Location', key: 'location', type: 'text' },
    ],
    body: [
      'Tag a note with `#company` for organizations you deal with. Link',
      'people to their company through the Company field on `#person` notes.',
    ].join('\n'),
  },
  {
    tag: 'Meeting',
    properties: [
      { name: 'Date', key: 'date', type: 'date' },
      { name: 'Attendees', key: 'attendees', type: 'relations' },
      { name: 'Project', key: 'project', type: 'relation' },
    ],
    body: [
      'Tag a note with `#meeting` for meeting notes. The Date field places',
      "them on this collection's calendar view; Attendees links the",
      '`[[people]]` who were there.',
    ].join('\n'),
  },
]

/**
 * The definition note's source for one default object — the exact shape
 * `saveTagType` writes (the `lore: tag` marker plus `properties`), so the
 * config dialog opens it as a typed tag with nothing to convert, followed by
 * an H1 and the explanatory body.
 */
export function defaultObjectSource(object: DefaultVaultObject): string {
  const frontmatter = upsertFrontmatter('', {
    lore: TAG_TYPE_MARKER,
    properties: object.properties.map((property) => ({
      name: property.name,
      key: property.key,
      type: property.type,
      ...(property.options === undefined ? {} : { options: property.options }),
    })),
  })
  return `${frontmatter}# ${object.tag}\n\n${object.body}\n`
}

/**
 * Write every default object's definition note (find-or-create — an existing
 * file at a path is never replaced). The decision of *when* to seed — a
 * completely empty vault, considered once per graph — belongs to the app's
 * first-run flow beside the welcome note; this is only the writes.
 */
export async function writeDefaultVaultObjects(generation: number): Promise<void> {
  for (const object of DEFAULT_VAULT_OBJECTS) {
    await createNoteIfAbsent(tagDefinitionPath(object.tag), defaultObjectSource(object), generation)
  }
}
