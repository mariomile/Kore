import { z } from 'zod'
import { isAppError } from '../errors'
import { assetContentIdentity, createNoteIfAbsent, readNote, writeNote } from '../graph/commands'
import { hashContent } from '../indexing/hash'
import { parseNote } from '../markdown/extract'
import { upsertFrontmatter } from '../markdown/frontmatter'
import { wikiLinkSafe } from '../markdown/edit'

export type ResourceKind = 'link' | 'image' | 'pdf' | 'file'

/** Context captured at insertion time, before any asynchronous work. */
export interface ResourceOrigin {
  generation: number
  sourcePath: string
  private: boolean
  /** Desktop metadata updates must respect an open editor's live buffer. */
  updateSources?: (path: string, sourceLink: string, generation: number) => Promise<void>
}

const labels: Record<ResourceKind, string> = {
  link: 'Links',
  image: 'Images',
  pdf: 'PDFs',
  file: 'Files',
}

const assetSchema = z
  .string()
  .refine(
    (path) =>
      path.startsWith('assets/') &&
      !/[\\\n\r]/.test(path) &&
      path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
  )
const sourcesSchema = z.array(z.string())
const pending = new Map<string, Promise<unknown>>()

/** Serialize resource updates in one graph so simultaneous inserts retain every origin. */
async function serializeResource<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = pending.get(key)
  const next = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(work)
  pending.set(key, next)
  try {
    return await next
  } finally {
    if (pending.get(key) === next) pending.delete(key)
  }
}

/** Only a standalone HTTP(S) URL is eligible; query parameters and fragments stay intact. */
export function resourceUrl(text: string): string | null {
  const value = text.trim()
  if (!/^https?:\/\/\S+$/i.test(value)) return null
  try {
    const url = new URL(value)
    return url.username || url.password ? null : url.href
  } catch {
    return null
  }
}

/** Infer a local file's collection without sending its contents anywhere. */
export function resourceFileKind(file: Pick<File, 'name' | 'type'>): ResourceKind {
  if (
    file.type.startsWith('image/') ||
    /\.(?:png|jpe?g|gif|webp|svg|tiff?|heic|avif|bmp)$/i.test(file.name)
  )
    return 'image'
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'pdf' : 'file'
}

/** Hash bounded chunks so large attachments do not need a full-file memory allocation. */
async function fileIdentity(file: Blob): Promise<string> {
  const hashes: string[] = []
  for (let offset = 0; offset < file.size; offset += 4 * 1024 * 1024) {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      await file.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer(),
    )
    hashes.push(
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    )
  }
  return await hashContent(`${file.size}:${hashes.join(':')}`)
}

async function existingSource(path: string, generation: number): Promise<string | null> {
  try {
    return await readNote(path, generation)
  } catch (cause) {
    if (isAppError(cause) && cause.kind === 'notFound') return null
    throw cause
  }
}

async function ensureResourceType(kind: ResourceKind, generation: number): Promise<void> {
  await createNoteIfAbsent(
    `tags/${kind}.md`,
    upsertFrontmatter(`# ${labels[kind]}\n`, {
      lore: 'tag',
      properties: [
        kind === 'link'
          ? { name: 'URL', key: 'url', type: 'url' }
          : { name: 'File', key: 'files', type: 'files' },
        { name: 'Saved', key: 'savedAt', type: 'date' },
        { name: 'Sources', key: 'sources', type: 'relations' },
      ],
    }),
    generation,
  )
}

async function saveCard(
  path: string,
  kind: ResourceKind,
  target: string,
  title: string,
  origin: ResourceOrigin,
): Promise<void> {
  await ensureResourceType(kind, origin.generation)
  const sourceLink = `[[${wikiLinkSafe(origin.sourcePath.replace(/\.md$/, ''))}]]`
  const safeTitle = wikiLinkSafe(title).replaceAll(/[\r\n]/g, ' ') || labels[kind]
  const destination = target.replaceAll(' ', '%20').replaceAll('(', '%28').replaceAll(')', '%29')
  const body = `# ${safeTitle}\n\n#${kind}\n\n${kind === 'image' ? '!' : ''}[${safeTitle.replaceAll(/[[\]]/g, '')}](${destination})\n`
  // Resource identity owns the filename; omit a managed ULID so title edits cannot move it.
  const seed = upsertFrontmatter(body, {
    resourceTarget: target,
    ...(kind === 'link' ? { url: target } : { files: [target] }),
    savedAt: new Date().toISOString().slice(0, 10),
    sources: [sourceLink],
    ...(origin.private ? { private: true } : {}),
  })
  const created = await createNoteIfAbsent(path, seed, origin.generation)
  if (created.kind === 'created') return
  const existing = await readNote(path, origin.generation)
  const meta = parseNote({ path, source: existing }).frontmatter
  if (meta['resourceTarget'] !== target)
    throw new Error('Resource note identity no longer matches its source')
  if (origin.updateSources !== undefined) {
    await origin.updateSources(path, sourceLink, origin.generation)
    return
  }
  const sources = sourcesSchema.parse(meta['sources'] ?? [])
  if (!sources.includes(sourceLink)) {
    await writeNote(
      path,
      upsertFrontmatter(existing, { sources: [...sources, sourceLink] }),
      origin.generation,
    )
  }
}

/** Save one URL card per graph and privacy scope, preserving its annotations on repeat capture. */
export async function collectResourceLink(
  url: string,
  title: string,
  origin: ResourceOrigin,
): Promise<string> {
  const target = resourceUrl(url)
  if (target === null) throw new Error('Only HTTP(S) links can be collected')
  const path = `notes/resource-${await hashContent(`${origin.private}:link:${target}`)}.md`
  await serializeResource(`${origin.generation}:${path}`, () =>
    saveCard(path, 'link', target, title, origin),
  )
  return path
}

/** Reuse an already collected binary, or upload it and create its Markdown card. */
export async function collectResourceFile(
  file: File,
  origin: ResourceOrigin,
  upload: () => Promise<string | null>,
): Promise<string | null> {
  const identity = await fileIdentity(file)
  const path = `notes/resource-${await hashContent(`${origin.private}:file:${identity}`)}.md`
  return await serializeResource(`${origin.generation}:${path}`, async () => {
    // A user may edit or delete the binary outside Kore. Preserve that card and
    // choose the next free slot rather than reuse different bytes or overwrite it.
    for (let suffix = 0; ; suffix += 1) {
      const candidate = suffix === 0 ? path : path.replace(/\.md$/, `-${suffix + 1}.md`)
      const source = await existingSource(candidate, origin.generation)
      if (source !== null) {
        const target = assetSchema.safeParse(
          parseNote({ path: candidate, source }).frontmatter['resourceTarget'],
        )
        if (!target.success) continue
        let currentIdentity: string | null
        try {
          currentIdentity = await assetContentIdentity(target.data, origin.generation)
        } catch (cause) {
          if (!isAppError(cause) || cause.kind !== 'notFound') throw cause
          currentIdentity = null
        }
        if (currentIdentity !== identity) continue
        await saveCard(candidate, resourceFileKind(file), target.data, file.name, origin)
        return target.data
      }
      const target = await upload()
      if (target === null) return null
      await saveCard(candidate, resourceFileKind(file), target, file.name, origin)
      return target
    }
  })
}
