import { tool } from 'ai'
import { isAppError } from '../../errors'
import type { ListTagTypesOptions, TagTypeEntry } from '../../indexing/collections'
import type { ListNoteTagsOptions, NoteTagFacet } from '../../indexing/note-list'
import { bodyHasTag } from '../../markdown/body-tag'
import { parseFrontmatter, splitFrontmatter } from '../../markdown/frontmatter'
import { isTagName } from '../../markdown/extract'
import { foldTag } from '../../markdown/keys'
import {
  EMPTY_TAG_TYPE,
  TAG_SYMBOL_CATALOG,
  isPropertyKey,
  parseTagTypeFrontmatter,
  propertyKeyForName,
  resolveTagIconInput,
  tagDefinitionPath,
  type TagProperty,
  type TagType,
} from '../../tags'
import { cloudSafeTagListings, type TagListingCandidate } from '../checkers'
import {
  EDIT_NOTE_MISSING_ERROR,
  EDITS_DISABLED_ERROR,
  INVALID_COLLECTION_TAG_ERROR,
  listTagIconsInput,
  listTagsInput,
  NOTE_TYPE_ABSENT_ERROR,
  NOTE_TYPE_UNCHANGED_ERROR,
  PRIVATE_NOTE_EDIT_ERROR,
  setNoteTypeInput,
  setTagIconInput,
  setTagSchemaInput,
  TAG_DEFINITION_UNMARKED_ERROR,
  TAG_ICON_UNCHANGED_ERROR,
  TAG_SCHEMA_COMPUTED_ERROR,
  TAG_SCHEMA_DUPLICATE_KEY_ERROR,
  TAG_SCHEMA_KEY_ERROR,
  TAG_SCHEMA_RENAME_ERROR,
  TAG_SCHEMA_UNCHANGED_ERROR,
  type ListTagIconsOutput,
  type ListTagsOutput,
  type SetNoteTypeOutput,
  type SetTagIconOutput,
  type SetTagSchemaOutput,
} from './tools-io'
import type { NoteTools } from './tools'

/**
 * The tag tools: what the graph's tags look like now (`list_tags`), which
 * icons the app can draw (`list_tag_icons`), and the three propose-only
 * writers whose proposals the user accepts or rejects in chat —
 * `set_tag_icon` for a tag's look, `set_tag_schema` for the property list
 * its collection renders as columns, and `set_note_type` for which tags a
 * note carries at all. Built here, registered by `./tools`.
 * The catalog is the whole point of the first: a model that cannot see the
 * icon set guesses names, and a guessed name can never be written —
 * `resolveTagIconInput` refuses it.
 */

/** Injectable effects for the tag tools (a test seam, like {@link NoteToolDeps}). */
export interface TagToolDeps {
  readNoteFn: (path: string) => Promise<string>
  listNoteTagsFn: (options: ListNoteTagsOptions) => Promise<NoteTagFacet[]>
  listTagTypesFn: (options: ListTagTypesOptions) => Promise<TagTypeEntry[]>
  /** The live privacy probe every outbound listing re-checks with (fail closed). */
  isPrivateLive: (path: string) => Promise<boolean>
  allowEdits: boolean
}

type TagTools = Pick<
  NoteTools,
  'list_tags' | 'list_tag_icons' | 'set_tag_icon' | 'set_tag_schema' | 'set_note_type'
>

/** Build the five tag tools over `deps`. */
export function buildTagTools(deps: TagToolDeps): TagTools {
  return {
    list_tags: tool({
      description:
        'List every tag in the graph with how many notes carry it, the icon its ' +
        'definition stores (an emoji, or icon:<name> from list_tag_icons; null when ' +
        'none) and how many collection properties it declares. Call it before ' +
        'changing a tag’s look or configuration, and to answer “which tags do I have”. ' +
        'Private notes are not counted.',
      inputSchema: listTagsInput,
      execute: async (): Promise<ListTagsOutput> => {
        // Private notes drop in SQL — a tag only they carry never reaches
        // this layer, and no count reveals one — and a private definition's
        // icon and schema drop with it; the gate then re-checks each
        // remaining definition live, like every listing tool.
        const [facets, types] = await Promise.all([
          deps.listNoteTagsFn({ excludePrivate: true }),
          deps.listTagTypesFn({ excludePrivate: true }),
        ])
        return {
          tags: await cloudSafeTagListings(mergeTagListings(facets, types), deps.isPrivateLive),
        }
      },
    }),

    list_tag_icons: tool({
      description:
        'List the symbol icons this app can draw for a tag — the only icon names ' +
        'set_tag_icon accepts besides a single emoji. Each entry is the stored name ' +
        'plus a short hint (theme group and glyph words). Pick from these names ' +
        'exactly; never invent one.',
      inputSchema: listTagIconsInput,
      execute: async (): Promise<ListTagIconsOutput> => ({ icons: TAG_SYMBOL_CATALOG }),
    }),

    set_tag_icon: tool({
      description:
        'Propose a new icon for a tag: a symbol name from list_tag_icons or one emoji ' +
        '(null removes it). The user reviews the change in chat and accepts or rejects ' +
        'it — nothing is written until they accept, so never claim it is done. Requires ' +
        '"Allow edits"; unknown icon names are refused, so list the icons first.',
      inputSchema: setTagIconInput,
      execute: async ({ tag, icon }): Promise<SetTagIconOutput> => {
        const name = tag.trim().replace(/^#+/, '')
        if (!deps.allowEdits) {
          return { ok: false, tag: name, error: EDITS_DISABLED_ERROR }
        }
        if (!isTagName(name)) {
          return { ok: false, tag: name, error: INVALID_COLLECTION_TAG_ERROR }
        }
        let resolved: string | null = null
        if (icon !== null) {
          const resolution = resolveTagIconInput(icon)
          if (!resolution.ok) {
            return { ok: false, tag: name, error: resolution.error }
          }
          resolved = resolution.icon
        }
        const path = tagDefinitionPath(name)
        const current = await readTagDefinition(path, deps.readNoteFn)
        if (!current.ok) {
          return { ok: false, tag: name, error: current.error }
        }
        const previousIcon = current.type.icon ?? null
        if (previousIcon === resolved) {
          return { ok: false, tag: name, error: TAG_ICON_UNCHANGED_ERROR }
        }
        return { ok: true, tag: name, path, icon: resolved, previousIcon }
      },
    }),

    set_note_type: tool({
      description:
        'Propose what a note *is*: put a tag on it, or take one off with remove. A ' +
        'tag is the note’s type and its collection membership at once, so this is how ' +
        'a note becomes a #book or joins #project — never by writing the hashtag into ' +
        'its text with edit_note. Accepting also fills in any created-date property ' +
        'the type declares. The user reviews the change in chat and accepts or rejects ' +
        'it — nothing is written until they accept, so never claim it is done. ' +
        'Requires "Allow edits"; private notes are refused.',
      inputSchema: setNoteTypeInput,
      execute: async ({ path, tag, remove }): Promise<SetNoteTypeOutput> => {
        const name = tag.trim().replace(/^#+/, '')
        const off = remove === true
        if (!deps.allowEdits) {
          return { ok: false, path, tag: name, error: EDITS_DISABLED_ERROR }
        }
        if (!isTagName(name)) {
          return { ok: false, path, tag: name, error: INVALID_COLLECTION_TAG_ERROR }
        }
        let source: string
        try {
          source = await deps.readNoteFn(path)
        } catch (cause) {
          if (isAppError(cause) && cause.kind === 'notFound') {
            return { ok: false, path, tag: name, error: EDIT_NOTE_MISSING_ERROR }
          }
          throw cause
        }
        // The privacy hard block on the live frontmatter, like every other
        // write: deciding what a private note *is* implies having read it.
        const { raw, body } = splitFrontmatter(source)
        if (parseFrontmatter(raw).data.private) {
          return { ok: false, path, tag: name, error: PRIVATE_NOTE_EDIT_ERROR }
        }
        // Membership is what the indexer scans out of the body, so both
        // "nothing to do" refusals ask the body — the same question the
        // accept's `appendBodyTag`/`removeBodyTag` will ask again.
        const carried = bodyHasTag(body, name)
        if (carried !== off) {
          return {
            ok: false,
            path,
            tag: name,
            error: off ? NOTE_TYPE_ABSENT_ERROR : NOTE_TYPE_UNCHANGED_ERROR,
          }
        }
        return { ok: true, path, tag: name, remove: off }
      },
    }),

    set_tag_schema: tool({
      description:
        'Propose the property schema of a tag — the columns its collection shows and ' +
        'the fields every note carrying it gets. Pass the whole schema you want, in ' +
        'order: read the current one first (list_collection returns it) and repeat the ' +
        'properties you keep, because anything left out is proposed for removal. To ' +
        'rename a property’s key, set "replaces" to the old key so the notes’ stored ' +
        'values move with it. The user reviews the change in chat and accepts or ' +
        'rejects it — nothing is written until they accept, so never claim it is done. ' +
        'Requires "Allow edits".',
      inputSchema: setTagSchemaInput,
      execute: async ({ tag, properties }): Promise<SetTagSchemaOutput> => {
        const name = tag.trim().replace(/^#+/, '')
        if (!deps.allowEdits) {
          return { ok: false, tag: name, error: EDITS_DISABLED_ERROR }
        }
        if (!isTagName(name)) {
          return { ok: false, tag: name, error: INVALID_COLLECTION_TAG_ERROR }
        }
        const path = tagDefinitionPath(name)
        const current = await readTagDefinition(path, deps.readNoteFn)
        if (!current.ok) {
          return { ok: false, tag: name, error: current.error }
        }
        const resolved = resolveTagSchema(properties, current.type)
        if (!resolved.ok) {
          return { ok: false, tag: name, error: resolved.error }
        }
        const previousProperties = current.type.properties
        if (sameSchema(resolved.properties, previousProperties)) {
          return { ok: false, tag: name, error: TAG_SCHEMA_UNCHANGED_ERROR }
        }
        return {
          ok: true,
          tag: name,
          path,
          properties: resolved.properties,
          previousProperties,
          renames: resolved.renames,
        }
      },
    }),
  }
}

/**
 * Is the proposal the schema the tag already has? Compared on the serialized
 * form, which is exactly what a save would write — so a reordering, a
 * renamed label or a changed option list all count as a change, and a
 * round-tripped identical list does not.
 */
function sameSchema(proposed: readonly TagProperty[], current: readonly TagProperty[]): boolean {
  return JSON.stringify(proposed) === JSON.stringify(current)
}

/**
 * One listing per tag key: the note facets (display casing, counts) joined
 * with the typed definitions (icon, schema size). A typed tag no note
 * carries yet still lists, with zero notes — its definition exists and the
 * user can see it in the sidebar.
 */
export function mergeTagListings(
  facets: readonly NoteTagFacet[],
  types: readonly TagTypeEntry[],
): TagListingCandidate[] {
  const typeByKey = new Map(types.map((entry) => [entry.tagKey, entry]))
  const listings = new Map<string, TagListingCandidate>()
  for (const facet of facets) {
    const key = foldTag(facet.tag)
    const entry = typeByKey.get(key)
    listings.set(key, {
      tag: facet.tag,
      notes: facet.count,
      icon: entry?.type.icon ?? null,
      properties: entry?.type.properties.length ?? 0,
      definitionPath: entry?.notePath ?? null,
    })
  }
  for (const entry of types) {
    if (!listings.has(entry.tagKey)) {
      listings.set(entry.tagKey, {
        tag: entry.tagKey,
        notes: 0,
        icon: entry.type.icon ?? null,
        properties: entry.type.properties.length,
        definitionPath: entry.notePath,
      })
    }
  }
  return [...listings]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, listing]) => listing)
}

type TagDefinitionRead = { ok: true; type: TagType } | { ok: false; error: string }

/**
 * The tag type a definition note stores now — the empty type for a
 * definition that does not exist yet, which the accept path creates. The two
 * refusals guard what a chat write must never do: read or touch a private
 * definition, or stamp the tag marker onto a regular note that merely lives
 * at the definition path (that conversion is the user's, from the tag page).
 */
async function readTagDefinition(
  path: string,
  readNoteFn: (path: string) => Promise<string>,
): Promise<TagDefinitionRead> {
  let source: string
  try {
    source = await readNoteFn(path)
  } catch (cause) {
    if (isAppError(cause) && cause.kind === 'notFound') {
      return { ok: true, type: EMPTY_TAG_TYPE }
    }
    throw cause
  }
  const frontmatter = parseFrontmatter(splitFrontmatter(source).raw).data
  if (frontmatter.private) {
    return { ok: false, error: PRIVATE_NOTE_EDIT_ERROR }
  }
  const type = parseTagTypeFrontmatter(frontmatter)
  if (type === null) {
    return { ok: false, error: TAG_DEFINITION_UNMARKED_ERROR }
  }
  return { ok: true, type }
}

/** The computed kinds: configured on the definition, never writable from chat. */
const COMPUTED_PROPERTY_TYPES: ReadonlySet<string> = new Set(['rollup', 'reverse', 'formula'])

/** One property as the model proposed it, before validation. */
interface ProposedProperty {
  name: string
  key?: string | null | undefined
  type: TagProperty['type']
  options?: string[] | null | undefined
  target?: string | null | undefined
  replaces?: string | null | undefined
}

type SchemaResolution =
  | { ok: true; properties: TagProperty[]; renames: { from: string; to: string }[] }
  | { ok: false; error: string }

/**
 * Turn the model's proposed property list into the schema an accept would
 * write, or the one refusal it has to fix first.
 *
 * The list is the tag's *whole* schema, so what the model leaves out is a
 * removal — deliberate, and what the review card shows the user. Three
 * things are decided here rather than trusted: a missing key is derived from
 * the name the way the dialog derives it, a computed property is carried
 * over from `current` by key (its stored config is the user's, and a guessed
 * one would be worse than none), and a `replaces` key is checked against the
 * schema as it is now — that is the rename whose stored values the accept
 * migrates.
 */
export function resolveTagSchema(
  proposed: readonly ProposedProperty[],
  current: TagType,
): SchemaResolution {
  const byKey = new Map(current.properties.map((property) => [property.key, property]))
  const properties: TagProperty[] = []
  const renames: { from: string; to: string }[] = []
  const claimed = new Set<string>()
  for (const entry of proposed) {
    const name = entry.name.trim()
    const key = (entry.key ?? '').trim() === '' ? propertyKeyForName(name) : entry.key!.trim()
    if (name === '' || !isPropertyKey(key)) {
      return { ok: false, error: TAG_SCHEMA_KEY_ERROR }
    }
    if (claimed.has(key)) {
      return { ok: false, error: TAG_SCHEMA_DUPLICATE_KEY_ERROR }
    }
    claimed.add(key)
    const replaces = (entry.replaces ?? '').trim()
    if (replaces !== '' && replaces !== key) {
      if (!byKey.has(replaces)) {
        return { ok: false, error: TAG_SCHEMA_RENAME_ERROR }
      }
      renames.push({ from: replaces, to: key })
    }
    if (COMPUTED_PROPERTY_TYPES.has(entry.type)) {
      // Carried over, never authored: only the property already stored under
      // this key, with this exact type, keeps its config. Anything else would
      // be a guessed rollup/reverse/formula the user never configured.
      const existing = byKey.get(key)
      if (existing === undefined || existing.type !== entry.type) {
        return { ok: false, error: TAG_SCHEMA_COMPUTED_ERROR }
      }
      properties.push({ ...existing, name })
      continue
    }
    const options = (entry.options ?? []).map((option) => option.trim()).filter((o) => o !== '')
    const target = (entry.target ?? '').trim().replace(/^#+/, '')
    properties.push({
      name,
      key,
      type: entry.type,
      ...(options.length > 0 ? { options } : {}),
      ...(target === '' ? {} : { target }),
    })
  }
  return { ok: true, properties, renames }
}
