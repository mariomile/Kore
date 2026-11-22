import { noteExists } from '../graph/commands'
import { isUntitledNotePath } from '../graph/create-note'
import {
  collisionStem,
  foldGraphPath,
  isDaily,
  notePath,
  noteFileStem,
  noteFileStemForTitle,
  templatePath,
} from '../graph/paths'
import { wikiNoteReference } from '../graph/note-reference'
import { getVaultLayout } from '../graph/vault-layout'
import { frontmatterTagNames } from '../markdown/extract'
import { parseFrontmatter, splitFrontmatter } from '../markdown/frontmatter'
import { foldKey } from '../markdown/keys'
import { displayNoteTitle } from '../markdown/note-title'
import { scanInlineSegments } from '../markdown/scan'
import { slugForTitle, titleFileStem } from '../markdown/slug'
import { typedNoteFolder } from '../tags/type-folder'
import { getTagType } from './collections'
import { db } from './db'

/**
 * Collision-free note-path selection — where a note's file should live for
 * its title. New notes are `notes/<slug>.md`; when that's taken,
 * `<slug>-2.md`, `-3`, … — the numeric suffix is the *entire* collision
 * policy (no id-tails on every filename for the rare clash). A candidate is
 * taken when **either** the index has a row for it or the file exists on
 * disk: the index lags the watcher by a debounce, and an unindexed file must
 * never be clobbered by a new note's slug.
 *
 * The entry points share one probe loop: {@link slugPathForTitle} /
 * {@link templateSlugPathForTitle} for the rename pipeline (the note's own
 * path always counts as free — a note never collides with itself, and never
 * "tightens" to a shorter suffix) and {@link availableTemplatePath} for
 * template creation. Note creation no longer probes here: it claims each
 * candidate atomically through the no-clobber `note_create` command
 * (`createNoteWithTitle`), where disk occupancy is the only authority.
 * See `docs/readable-filenames.md`.
 */

/** Templates are always slug-named, whatever the vault does for notes. */
function slugCollisionStem(slug: string, ordinal: number): string {
  return ordinal === 1 ? slug : `${slug}-${ordinal}`
}

/** Is `path` already taken — indexed, or present on disk? */
async function pathTaken(path: string): Promise<boolean> {
  const row = await db
    .selectFrom('notes')
    .where('path', '=', path)
    .select('path')
    .executeTakeFirst()
  if (row !== undefined) {
    return true
  }
  return await noteExists(path)
}

/**
 * Far beyond any real graph's same-slug population; hitting it means the
 * probe is lying (e.g. always-true), and failing loud beats spinning.
 */
const MAX_COLLISION_PROBES = 1000

/**
 * The one probe loop the entry points share: candidates are the bare slug,
 * then `-2`, `-3`, …; the note's own current path (when given) is always an
 * acceptable answer — a note never collides with itself.
 */
async function probeNotePath(
  slug: string,
  taken: (candidate: string) => Promise<boolean>,
  currentPath: string | null,
  buildPath: (slug: string) => string = notePath,
  suffixed: (slug: string, ordinal: number) => string = collisionStem,
): Promise<string> {
  for (let ordinal = 1; ordinal <= MAX_COLLISION_PROBES; ordinal += 1) {
    const candidate = buildPath(suffixed(slug, ordinal))
    // Case-folded: title filenames keep the title's case, and a retitle that
    // only changes case must not "collide" with its own file on a
    // case-insensitive disk. The file keeps its current spelling.
    if (currentPath !== null && foldGraphPath(candidate) === foldGraphPath(currentPath)) {
      return currentPath
    }
    if (!(await taken(candidate))) {
      return candidate
    }
  }
  throw new Error(`no available note path for slug "${slug}" after ${MAX_COLLISION_PROBES} probes`)
}

/**
 * The first available `templates/…` path for `slug` (template creation) —
 * the shared probe and collision suffix, in the templates directory. `taken`
 * is injectable for tests; the default probes the index and the filesystem.
 */
export async function availableTemplatePath(
  slug: string,
  taken: (path: string) => Promise<boolean> = pathTaken,
): Promise<string> {
  return await probeNotePath(slug, taken, null, templatePath, slugCollisionStem)
}

/**
 * Where `path`'s template file should live for `title` (the settings rename's
 * target) — {@link slugPathForTitle}'s semantics in the templates directory:
 * the template's own path always counts as free, so a no-op rename never
 * "moves" a file onto a `-2` suffix.
 */
export async function templateSlugPathForTitle(
  path: string,
  title: string,
  taken: (candidate: string) => Promise<boolean> = pathTaken,
): Promise<string> {
  return await probeNotePath(slugForTitle(title), taken, path, templatePath, slugCollisionStem)
}

/**
 * Where `path`'s file should live for `title` (the rename pipeline's target,
 * Plan 17): the slug path with a collision suffix — or `path` unchanged when
 * its name already matches, so a note never moves onto (or collides with)
 * itself.
 */
export async function slugPathForTitle(
  path: string,
  title: string,
  taken: (candidate: string) => Promise<boolean> = pathTaken,
): Promise<string> {
  return await probeNotePath(noteFileStemForTitle(title), taken, path)
}

/**
 * Does `title` hold a wiki link addressing the file at `path` itself
 * (`# [[Resources/HEART|HEART]]` in `Resources/HEART.md`)? Renaming that file
 * would leave its own title pointing at a path that no longer exists.
 */
function titleLinksToFile(title: string, path: string): boolean {
  const pathKey = foldGraphPath(path)
  return scanInlineSegments(title).some((segment) => {
    if (segment.kind !== 'wikiLink') {
      return false
    }
    const reference = wikiNoteReference(segment.target)
    return (
      (reference?.kind === 'path' || reference?.kind === 'pathOrKey') &&
      foldGraphPath(reference.path) === pathKey
    )
  })
}

/**
 * Where a retitled note's file goes in a vault that names files after titles
 * (an Obsidian vault): the new title's filename, in the folder the note
 * already lives in, as renaming a note in Obsidian does. `null` when the
 * filename was not the old title's own (a frontmatter `title:` over a
 * differently named file): that note's name is not its title, so the file
 * stays, and so does a file whose title links to the file itself. Slug
 * vaults never answer here; their adopted notes keep their paths
 * (`docs/readable-filenames.md`). Titles compare by what they display, so
 * `# Meeting with [[Ada]]` names `Meeting with Ada.md`.
 */
export async function titleFilePathForRetitle(
  path: string,
  rename: { from: string; to: string },
  taken: (candidate: string) => Promise<boolean> = pathTaken,
): Promise<string | null> {
  if (getVaultLayout().noteFileNames !== 'title') {
    return null
  }
  const folder = path.slice(0, path.lastIndexOf('/') + 1)
  if (foldKey(titleFileStem(displayNoteTitle(rename.from))) !== foldKey(noteFileStem(path))) {
    return null
  }
  if (titleLinksToFile(rename.to, path)) {
    return null
  }
  return await probeNotePath(
    titleFileStem(displayNoteTitle(rename.to)),
    taken,
    path,
    (candidate) => `${folder}${candidate}.md`,
  )
}

/**
 * Where an untitled note's file goes at its birth rename (its first title):
 * {@link slugPathForTitle}'s slug path, unless the note's type declares a
 * home folder (`folder:`), in which case the note is born there — a Project
 * made from a board's "+" lands in `Active/Projects/<Name>/<Name>.md`, not in
 * the new-note folder. The type is read from the note's own frontmatter
 * `tags:` (`source`), the first one with a home winning, so the decision
 * never waits on the index. Only the birth consults the type: a note that
 * already has a title never moves because of its type.
 */
export async function birthPathForTitle(
  path: string,
  title: string,
  source: string,
  taken: (candidate: string) => Promise<boolean> = pathTaken,
): Promise<string> {
  const tags = frontmatterTagNames(parseFrontmatter(splitFrontmatter(source).raw).data)
  for (const tag of tags) {
    const home = (await getTagType(tag))?.folder
    if (home !== undefined) {
      return await probeNotePath(
        noteFileStemForTitle(title),
        taken,
        path,
        (stem) => `${typedNoteFolder(home, stem)}/${stem}.md`,
      )
    }
  }
  return await slugPathForTitle(path, title, taken)
}

/**
 * Where a titled note sitting directly in the vault's new-note / inbox folder
 * (`VaultLayout.newNoteFolder`) moves when the user adds a `#tag` declaring a
 * `folder:` home. Returns `null` when the note is already filed in another
 * folder (so multi-tag notes never fight over folders), is a daily note, is an
 * untitled ULID placeholder (handled by {@link birthPathForTitle} once titled),
 * or is already in the tag's folder.
 */
export async function homePathForTaggedInboxNote(
  path: string,
  homeFolder: string,
  taken: (candidate: string) => Promise<boolean> = pathTaken,
): Promise<string | null> {
  if (!path.endsWith('.md') || isDaily(path) || isUntitledNotePath(path)) {
    return null
  }
  const currentFolder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const inboxFolder = getVaultLayout().newNoteFolder.replaceAll(/^\/+|\/+$/g, '')
  if (foldGraphPath(currentFolder) !== foldGraphPath(inboxFolder)) {
    return null
  }
  const stem = noteFileStem(path)
  const destFolder = typedNoteFolder(homeFolder, stem).replaceAll(/^\/+|\/+$/g, '')
  if (destFolder === '' || foldGraphPath(destFolder) === foldGraphPath(currentFolder)) {
    return null
  }
  return await probeNotePath(
    stem,
    taken,
    path,
    (candidate) => `${typedNoteFolder(homeFolder, candidate)}/${candidate}.md`,
  )
}
