import { tool } from 'ai'
import { isAppError } from '../../errors'
import type { TagTypeEntry } from '../../indexing/collections'
import type { NoteTagFacet } from '../../indexing/note-list'
import { parseFrontmatter, splitFrontmatter } from '../../markdown/frontmatter'
import { isTagName } from '../../markdown/extract'
import { foldTag } from '../../markdown/keys'
import {
  TAG_SYMBOL_CATALOG,
  parseTagTypeFrontmatter,
  resolveTagIconInput,
  tagDefinitionPath,
} from '../../tags'
import {
  EDITS_DISABLED_ERROR,
  INVALID_COLLECTION_TAG_ERROR,
  listTagIconsInput,
  listTagsInput,
  PRIVATE_NOTE_EDIT_ERROR,
  setTagIconInput,
  TAG_DEFINITION_UNMARKED_ERROR,
  TAG_ICON_UNCHANGED_ERROR,
  type ListTagIconsOutput,
  type ListTagsOutput,
  type SetTagIconOutput,
  type TagListing,
} from './tools-io'
import type { NoteTools } from './tools'

/**
 * The tag tools: what the graph's tags look like now (`list_tags`), which
 * icons the app can draw (`list_tag_icons`), and the propose-only
 * `set_tag_icon` whose proposal the user accepts or rejects in chat. Built
 * here, registered by `./tools`. The catalog is the whole point: a model
 * that cannot see the icon set guesses names, and a guessed name can never
 * be written — `resolveTagIconInput` refuses it.
 */

/** Injectable effects for the tag tools (a test seam, like {@link NoteToolDeps}). */
export interface TagToolDeps {
  readNoteFn: (path: string) => Promise<string>
  listNoteTagsFn: () => Promise<NoteTagFacet[]>
  listTagTypesFn: () => Promise<TagTypeEntry[]>
  allowEdits: boolean
}

type TagTools = Pick<NoteTools, 'list_tags' | 'list_tag_icons' | 'set_tag_icon'>

/** Build the three tag tools over `deps`. */
export function buildTagTools(deps: TagToolDeps): TagTools {
  return {
    list_tags: tool({
      description:
        'List every tag in the graph with how many notes carry it, the icon its ' +
        'definition stores (an emoji, or icon:<name> from list_tag_icons; null when ' +
        'none) and how many collection properties it declares. Call it before ' +
        'changing a tag’s look or configuration, and to answer “which tags do I have”.',
      inputSchema: listTagsInput,
      execute: async (): Promise<ListTagsOutput> => {
        const [facets, types] = await Promise.all([deps.listNoteTagsFn(), deps.listTagTypesFn()])
        return { tags: mergeTagListings(facets, types) }
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
        const current = await readTagDefinitionIcon(path, deps.readNoteFn)
        if (!current.ok) {
          return { ok: false, tag: name, error: current.error }
        }
        if (current.icon === resolved) {
          return { ok: false, tag: name, error: TAG_ICON_UNCHANGED_ERROR }
        }
        return { ok: true, tag: name, path, icon: resolved, previousIcon: current.icon }
      },
    }),
  }
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
): TagListing[] {
  const typeByKey = new Map(types.map((entry) => [entry.tagKey, entry.type]))
  const listings = new Map<string, TagListing>()
  for (const facet of facets) {
    const key = foldTag(facet.tag)
    const type = typeByKey.get(key)
    listings.set(key, {
      tag: facet.tag,
      notes: facet.count,
      icon: type?.icon ?? null,
      properties: type?.properties.length ?? 0,
    })
  }
  for (const entry of types) {
    if (!listings.has(entry.tagKey)) {
      listings.set(entry.tagKey, {
        tag: entry.tagKey,
        notes: 0,
        icon: entry.type.icon ?? null,
        properties: entry.type.properties.length,
      })
    }
  }
  return [...listings]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, listing]) => listing)
}

type TagDefinitionIcon = { ok: true; icon: string | null } | { ok: false; error: string }

/**
 * The icon a tag's definition note stores now (`null` for none, and for a
 * definition that does not exist yet — the accept path creates it). The two
 * refusals guard what a chat write must never do: read or touch a private
 * definition, or stamp the tag marker onto a regular note that merely lives
 * at the definition path (that conversion is the user's, from the tag page).
 */
async function readTagDefinitionIcon(
  path: string,
  readNoteFn: (path: string) => Promise<string>,
): Promise<TagDefinitionIcon> {
  let source: string
  try {
    source = await readNoteFn(path)
  } catch (cause) {
    if (isAppError(cause) && cause.kind === 'notFound') {
      return { ok: true, icon: null }
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
  return { ok: true, icon: type.icon ?? null }
}
