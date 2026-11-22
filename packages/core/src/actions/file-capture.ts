import { isAppError } from '../errors'
import { importCaptureSpool } from '../graph/assets'
import { assetFileName } from '../graph/asset-names'
import { markdownLinkDestination } from '../markdown/link-destination'
import type { FileCaptureEnvelope } from './capture-envelope'
import { placeCapture, type PlacedCaptureOutcome } from './placed-capture'

/**
 * Shared files (photos, PDFs from the iOS share sheet): each spooled copy
 * moves into the vault's attachment folder, then one block lands where the
 * share sheet said, in the daily's own body like anything the user writes.
 * The Markdown is what dropping the same file into the editor writes, so the
 * result reads the same in Kore, in Obsidian, and to an agent.
 */

/** Extensions the editor draws inline as an image; everything else is a file link. */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'heic', 'heif'])

/** One file as it now sits in the vault. */
export interface PlacedFile {
  /** Graph-relative path of the attachment. */
  readonly path: string
  /** The name shown on a file link: the file's name as shared. */
  readonly name: string
}

function isImage(path: string): boolean {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return IMAGE_EXTENSIONS.has(extension)
}

/** The file's own name, its extension taken from the spooled copy when it has none. */
function desiredName(name: string, ref: string): string {
  const extension = ref.slice(ref.lastIndexOf('.') + 1)
  const named = assetFileName(name)
  return named.includes('.') ? named : `${named || 'shared'}.${extension}`
}

/**
 * The Markdown block for shared files: each image as `![](…)`, each other
 * file as a `[name](…)` link (the editor's file pill), one per paragraph,
 * then the user's own note.
 */
export function fileCaptureBlock(files: readonly PlacedFile[], note?: string): string {
  const parts = files.map((file) => {
    const destination = markdownLinkDestination(file.path)
    if (isImage(file.path)) {
      return `![](${destination})`
    }
    const label = file.name.replaceAll(/[[\]\\]/g, String.raw`\$&`)
    return `[${label}](${destination})`
  })
  const thought = note?.trim()
  if (thought) {
    parts.push(thought)
  }
  return parts.join('\n\n')
}

/**
 * Move a file capture's spooled files into the vault and write them where
 * the share sheet said; `null` when none of them arrived and there is
 * nothing else to write. The spooled copies stay until the caller removes
 * them, and importing one again returns the copy already in the vault, so a
 * failure part-way only ever costs a retry, never a second attachment.
 */
export async function drainFileCapture(
  envelope: FileCaptureEnvelope,
  generation: number,
): Promise<PlacedCaptureOutcome | null> {
  const files: PlacedFile[] = []
  for (const file of envelope.files) {
    try {
      const path = await importCaptureSpool(file.ref, desiredName(file.name, file.ref), generation)
      files.push({ path, name: file.name })
    } catch (cause) {
      // A file the relay quarantined (over its size cap) never arrives;
      // the rest of the share still lands. Anything else stops the pass.
      if (!isAppError(cause) || cause.kind !== 'notFound') {
        throw cause
      }
    }
  }
  if (files.length === 0 && !envelope.note?.trim()) {
    return null
  }
  const first = files[0]?.name ?? ''
  return await placeCapture(
    {
      destination: envelope.destination,
      capturedAt: envelope.capturedAt,
      title: first.replace(/\.[^.]+$/, '') || 'Shared files',
      dailySpot: 'body',
      block: async () => fileCaptureBlock(files, envelope.note),
    },
    generation,
  )
}
