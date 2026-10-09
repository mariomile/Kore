import { errorMessage } from '../errors'
import { listAttachments } from './commands'
import { isAttachmentPath } from './paths'
import { getVaultLayout } from './vault-layout'

/**
 * Where an image or file reference written in a note actually lives.
 *
 * Kore writes `assets/…` paths, but an adopted vault (Obsidian's above all)
 * refers to attachments the way its own app does: a bare `![[photo.png]]`
 * that Obsidian finds anywhere in the vault, a partial `![[2024/photo.png]]`,
 * or a vault-relative `![](Resources/_attachments/photo%20one.png)`. The
 * index is the vault's attachment catalog by lowercased file name, loaded
 * once per graph open, so the editor's synchronous image resolver can answer
 * without an IPC round-trip.
 */
interface AttachmentIndex {
  readonly paths: ReadonlySet<string>
  /** Lowercased file name → every catalog path with that name, sorted. */
  readonly byName: ReadonlyMap<string, readonly string[]>
}

let activeIndex: AttachmentIndex | null = null

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function buildIndex(paths: readonly string[]): AttachmentIndex {
  const byName = new Map<string, string[]>()
  for (const path of [...paths].sort()) {
    const key = fileName(path).toLowerCase()
    const existing = byName.get(key)
    if (existing === undefined) {
      byName.set(key, [path])
    } else {
      existing.push(path)
    }
  }
  return { paths: new Set(paths), byName }
}

/** Install the attachment catalog for the open graph (exposed for tests and the dev bridge). */
export function setAttachmentIndex(paths: readonly string[] | null): void {
  activeIndex = paths === null ? null : buildIndex(paths)
}

/**
 * Load the open graph's attachment catalog. Best-effort: on failure the
 * resolver still answers vault-relative paths and the attachment folder,
 * only bare-name lookups elsewhere in the vault go unresolved.
 */
export async function loadAttachmentIndex(generation?: number): Promise<void> {
  activeIndex = null
  try {
    const files = await listAttachments(generation)
    setAttachmentIndex(files.map((file) => file.path))
  } catch (cause) {
    console.error('attachment index: could not list attachments:', errorMessage(cause))
  }
}

/** Record an attachment Kore just wrote, so a bare-name reference to it resolves at once. */
export function noteAttachmentAdded(path: string): void {
  if (activeIndex !== null && !activeIndex.paths.has(path)) {
    setAttachmentIndex([...activeIndex.paths, path])
  }
}

function decodePath(src: string): string {
  try {
    return decodeURI(src)
  } catch {
    return src
  }
}

/** Among same-named files, the attachment folder's copy wins, then the first by path. */
function pickCandidate(candidates: readonly string[], folder: string | null): string | undefined {
  if (folder !== null) {
    const preferred = candidates.find((candidate) => candidate.startsWith(`${folder}/`))
    if (preferred !== undefined) {
      return preferred
    }
  }
  return candidates[0]
}

/**
 * Resolve an image source or file-link destination written in a note to the
 * graph-relative attachment it names, or `null` when it names none (a remote
 * URL, a note, an unsupported or unsafe path). Every answer is a safe,
 * visible attachment path; the Rust asset protocol re-checks it anyway.
 *
 * 1. An exact vault-relative path (`assets/x.png`, `Resources/_attachments/x.png`,
 *    percent-encoded or not) answers as itself.
 * 2. Otherwise the catalog is searched by file name, as Obsidian does for
 *    `![[x.png]]`; a partial path (`2024/x.png`) must match the end of the
 *    found path. The vault's attachment folder breaks ties.
 * 3. A bare name the catalog doesn't know yet (a file added since the open)
 *    falls back to the attachment folder, when the vault declares one.
 */
export function resolveAttachmentSource(src: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) {
    return null
  }
  const path = decodePath(src.startsWith('./') ? src.slice(2) : src)
  if (!isAttachmentPath(path)) {
    return null
  }
  const index = activeIndex
  if (index === null || index.paths.has(path)) {
    return path.includes('/') || index !== null ? path : fallbackFor(path)
  }
  const candidates = (index.byName.get(fileName(path).toLowerCase()) ?? []).filter(
    (candidate) =>
      !path.includes('/') || candidate.toLowerCase().endsWith(`/${path.toLowerCase()}`),
  )
  const found = pickCandidate(candidates, getVaultLayout().attachmentFolder)
  if (found !== undefined) {
    return found
  }
  return path.includes('/') ? path : fallbackFor(path)
}

function fallbackFor(name: string): string | null {
  const folder = getVaultLayout().attachmentFolder
  return folder === null ? null : `${folder}/${name}`
}
