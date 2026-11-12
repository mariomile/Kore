import { ulid } from 'ulidx'
import { upsertFrontmatter } from '../markdown/frontmatter'
import { addNoteTag } from '../markdown/note-tag'
import { createNoteIfAbsent } from './commands'
import { wikiNoteReference } from './note-reference'
import {
  collisionStem,
  newNoteFolderPrefix,
  notePath,
  noteFileStem,
  noteFileStemForTitle,
} from './paths'
import {
  resolveExistingWikiTarget,
  type ExistingWikiTargetResolution,
} from './resolve-existing-wiki-target'

/**
 * Note identity at creation (`docs/readable-filenames.md`): regular notes get
 * a **title-derived filename** (`notes/<slug>.md`, `-2` suffix on collision)
 * and a frontmatter
 * `id:` ULID — the durable identity Plan 02 specified, which survives the
 * renames that now follow title changes (17b).
 */

/** A fresh frontmatter `id` (lowercase ULID, matching the filename convention). */
export function newNoteId(): string {
  return ulid().toLowerCase()
}

/**
 * The on-disk source for a brand-new note: `id:` frontmatter + H1 title,
 * plus an optional body block under the title (e.g. the add-meeting action's
 * `- Type: #person` line).
 */
export function newNoteSource(title: string, body?: string): string {
  const content = body ? `# ${title.trim()}\n\n${body.trim()}\n` : `# ${title.trim()}\n`
  return upsertFrontmatter(content, { id: newNoteId() })
}

/**
 * The buffer seed for a ⌘N note (created lazily on the first keystroke): an
 * empty H1 — the caret lands in it, the editor ghosts "Untitled" over it
 * (`title-placeholder.ts`), and typing names the note — plus a fresh `id:`.
 * The id rides the seed's header through the session, so it lands on disk
 * with the note's first real save. The `#` carries no trailing space: that
 * is the serializer's round-trip form, and anything else would classify the
 * seed lossy and open the new note read-only.
 */
export function untitledNoteSeed(): string {
  return upsertFrontmatter('#\n', { id: newNoteId() })
}

/**
 * The birth path for a ⌘N note: no title exists yet, so the filename is a
 * ULID placeholder — the first settled title replaces it with the slug
 * (Plan 17's birth rename). The one author of the ULID-path convention.
 */
export function untitledNotePath(): string {
  return notePath(newNoteId())
}

/** A 26-char Crockford-base32 ULID filename — {@link untitledNotePath}'s shape. */
const ULID_NOTE_FILE_RE = /^[0-7][0-9a-hjkmnp-tv-z]{25}\.md$/

/**
 * Is `path` a ULID placeholder name — a note born untitled that has not yet
 * shed it for a title slug (Plan 17's birth rename)? The sidebar's "New note"
 * row uses this to show as active while such a note is the current route.
 */
export function isUntitledNotePath(path: string): boolean {
  const prefix = newNoteFolderPrefix()
  return path.startsWith(prefix) && ULID_NOTE_FILE_RE.test(path.slice(prefix.length))
}

/**
 * The title an open-note tab (the strip and its list menu) shows for
 * `path`. A ⌘N note keeps its ULID placeholder path until its title settles
 * (the birth rename fires after 5s of quiet or on blur, and a refused move
 * keeps the placeholder for good), so the path alone cannot name it:
 *
 * - `draftTitle` — the title the open editor session last saved — wins, so
 *   the tab follows typing instead of waiting for the rename;
 * - otherwise the index title, except on a placeholder path where an
 *   unauthored row falls back to the ULID stem: that reads "Untitled";
 * - otherwise the filename stem, while the index has not caught up.
 */
export function openNoteTabTitle(
  path: string,
  indexTitle: string | null | undefined,
  draftTitle: string | null | undefined,
): string {
  if (draftTitle !== null && draftTitle !== undefined && draftTitle.trim() !== '') {
    return draftTitle
  }
  if (isUntitledNotePath(path)) {
    const stem = noteFileStem(path)
    return indexTitle !== null && indexTitle !== undefined && indexTitle !== stem
      ? indexTitle
      : 'Untitled'
  }
  return indexTitle ?? noteFileStem(path)
}

/**
 * Create a new note titled `title` (Plan 07's create-from-unresolved) at a
 * collision-free slug path, optionally with a body block under the H1.
 * Returns the new graph-relative path. The write carries `generation`, so a
 * create racing a graph switch is rejected loudly instead of landing in the
 * wrong graph.
 */
export async function createNoteWithTitle(
  title: string,
  generation: number,
  body?: string,
): Promise<string> {
  const claimed = await claimNotePathForSlug(
    noteFileStemForTitle(title),
    newNoteSource(title, body),
    generation,
    null,
  )
  return claimed.path
}

/**
 * The on-disk source for a brand-new note of type `tag`: `id:`, the type in
 * the frontmatter `tags:` list (the Type field, where #401 says a note's
 * type lives) and any starting `properties`, then the H1. One string, so the
 * note is born whole in a single atomic create.
 *
 * The type deliberately does not ride a `#tag` line in the body: the editor
 * hides that line under the Type chips, so ordinary typing in the body could
 * delete it unseen, and with it the note's type and every field the type
 * brings (the "frontmatter broke" report on a Company created from a
 * Person's Company field).
 */
export function newTypedNoteSource(
  title: string,
  tag: string,
  properties: Record<string, unknown> = {},
): string {
  const base = newNoteSource(title)
  // The note's own `id:` and type are this function's to write; a starting
  // value can never replace them.
  const fields = Object.fromEntries(
    Object.entries(properties).filter(([key]) => key !== 'id' && key !== 'tags'),
  )
  const withProperties = Object.keys(fields).length === 0 ? base : upsertFrontmatter(base, fields)
  return addNoteTag(withProperties, tag) ?? withProperties
}

/**
 * Create a note titled `title` whose type is `tag` (see
 * {@link newTypedNoteSource}) at a collision-free slug path in the vault's
 * new-note folder. Returns the new graph-relative path.
 */
export async function createTypedNoteWithTitle(
  title: string,
  tag: string,
  properties: Record<string, unknown>,
  generation: number,
): Promise<string> {
  const claimed = await claimNotePathForSlug(
    noteFileStemForTitle(title),
    newTypedNoteSource(title, tag, properties),
    generation,
    null,
  )
  return claimed.path
}

/**
 * Create a note titled `title` from a ready `source` (H1, `id:` and any
 * frontmatter already in it) at a collision-free path named like every
 * create-from-title. `folder` is graph-relative (`''` is the vault root);
 * null keeps the vault's new-note folder. Returns the new path.
 */
export async function createNoteWithSource(
  title: string,
  source: string,
  generation: number,
  folder: string | null,
): Promise<string> {
  const claimed = await claimNotePathForSlug(
    noteFileStemForTitle(title),
    source,
    generation,
    folder,
  )
  return claimed.path
}

/** Far beyond any real graph's same-slug population; fail loud instead of spinning. */
const MAX_CREATE_ATTEMPTS = 1000

/** The outcome of resolving an existing wiki target or safely creating it. */
export type ResolveOrCreateNoteResult =
  | { readonly kind: 'resolved'; readonly path: string }
  | { readonly kind: 'created'; readonly path: string }
  | { readonly kind: 'ambiguous'; readonly paths: readonly string[] }
  | { readonly kind: 'unavailable'; readonly paths: readonly string[] }

type ExistingTitleResolution = Exclude<ExistingWikiTargetResolution, { kind: 'missing' }>

/**
 * Claim the first free path in `slug`'s collision family (`slug.md`, then
 * `slug-2.md`, … — see {@link collisionStem}) through the atomic no-clobber create — the one ordinal
 * convention both create entry points share. `onCollision` runs after each
 * lost claim; a non-null result short-circuits instead of trying the next
 * suffix (`resolveOrCreateNoteWithTitle` re-resolves the winner there).
 */
async function claimNotePathForSlug(
  slug: string,
  source: string,
  generation: number,
  folder: string | null,
): Promise<{ kind: 'created'; path: string }>
async function claimNotePathForSlug(
  slug: string,
  source: string,
  generation: number,
  folder: string | null,
  onCollision: () => Promise<ExistingTitleResolution | null>,
): Promise<ResolveOrCreateNoteResult>
async function claimNotePathForSlug(
  slug: string,
  source: string,
  generation: number,
  folder: string | null,
  onCollision?: () => Promise<ExistingTitleResolution | null>,
): Promise<ResolveOrCreateNoteResult> {
  for (let ordinal = 1; ordinal <= MAX_CREATE_ATTEMPTS; ordinal += 1) {
    const stem = collisionStem(slug, ordinal)
    const path =
      folder === null ? notePath(stem) : folder === '' ? `${stem}.md` : `${folder}/${stem}.md`
    const outcome = await createNoteIfAbsent(path, source, generation)
    if (outcome.kind === 'created') {
      return { kind: 'created', path }
    }
    const resolution = (await onCollision?.()) ?? null
    if (resolution !== null) {
      return resolution
    }
  }
  throw new Error(`no available note path for slug "${slug}" after ${MAX_CREATE_ATTEMPTS} attempts`)
}

/**
 * Resolve a wiki-link title while guarding its title-derived creation path
 * against a stale per-device index.
 *
 * Delegates the read-only decision to {@link resolveExistingWikiTarget}, so
 * date/title/alias precedence, ambiguity, unavailable files, the bounded disk
 * fallback, and the final index race check have one implementation. Only a
 * genuine `missing` result reaches the atomic no-clobber claim. If that claim
 * loses to a concurrent sync checkout or creator, the winner is resolved
 * before any suffix is tried. `body` seeds only a genuinely new note; an
 * existing title or alias is left untouched.
 */
export async function resolveOrCreateNoteWithTitle(
  title: string,
  generation: number,
  body?: string,
): Promise<ResolveOrCreateNoteResult> {
  const existing = await resolveExistingWikiTarget(title, generation)
  if (existing.kind !== 'missing') {
    return existing
  }

  // A bare name invents a titled note under `notes/`; so does an ambiguous
  // slashed spelling once both of its readings have missed, because the
  // author typed it where a title goes. Only an explicitly rooted path (one
  // exact missing file) and a `#heading` or unsafe target (which name
  // nothing creatable) refuse.
  const reference = wikiNoteReference(title)
  if (reference?.kind !== 'key' && reference?.kind !== 'pathOrKey') {
    return {
      kind: 'unavailable',
      paths: reference?.kind === 'path' ? [reference.path] : [],
    }
  }

  // On a lost claim, re-resolve both projections before considering a
  // suffix: the winner may be the note this link meant.
  return await claimNotePathForSlug(
    noteFileStemForTitle(title),
    newNoteSource(title, body),
    generation,
    null,
    async () => {
      const collisionResolution = await resolveExistingWikiTarget(title, generation)
      return collisionResolution.kind === 'missing' ? null : collisionResolution
    },
  )
}
