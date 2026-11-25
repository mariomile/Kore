import { listAttachments } from '../graph/commands'
import { ASSETS_DIR, isAttachmentPath } from '../graph/paths'
import type { FileChange } from './file-changes'
import { getVaultLayout } from '../graph/vault-layout'
import { db } from './db'

/** What a loose file's card shows it as. */
export type LooseFileKind =
  | 'image'
  | 'pdf'
  | 'html'
  | 'document'
  | 'sheet'
  | 'audio'
  | 'video'
  | 'archive'
  | 'other'

/** A file that lives in a folder on its own: no note embeds or links it. */
export interface LooseFile {
  /** Graph-relative path. */
  readonly path: string
  /** The file name, extension included. */
  readonly name: string
  /** The lowercased extension, without the dot. */
  readonly extension: string
  readonly kind: LooseFileKind
  readonly size: number
  /** Last-modified time in epoch milliseconds. */
  readonly modifiedMs: number
}

const KIND_BY_EXTENSION: Readonly<Record<string, LooseFileKind>> = {
  avif: 'image',
  bmp: 'image',
  gif: 'image',
  heic: 'image',
  jpeg: 'image',
  jpg: 'image',
  png: 'image',
  svg: 'image',
  webp: 'image',
  pdf: 'pdf',
  htm: 'html',
  html: 'html',
  doc: 'document',
  docx: 'document',
  epub: 'document',
  key: 'document',
  odp: 'document',
  odt: 'document',
  pages: 'document',
  pptx: 'document',
  rtf: 'document',
  txt: 'document',
  csv: 'sheet',
  numbers: 'sheet',
  ods: 'sheet',
  tsv: 'sheet',
  xls: 'sheet',
  xlsx: 'sheet',
  flac: 'audio',
  m4a: 'audio',
  mp3: 'audio',
  ogg: 'audio',
  opus: 'audio',
  wav: 'audio',
  '3gp': 'video',
  mkv: 'video',
  mov: 'video',
  mp4: 'video',
  ogv: 'video',
  webm: 'video',
  '7z': 'archive',
  gz: 'archive',
  rar: 'archive',
  tar: 'archive',
  zip: 'archive',
}

/**
 * Formats that are Kore's own views of the vault (a canvas, a base), never
 * loose files: they open as screens of their own.
 */
const VIEW_EXTENSIONS = new Set(['base', 'canvas'])

/** SQLite's bound-parameter budget, with room to spare. */
const QUERY_CHUNK = 400

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

function underFolder(path: string, folder: string, includeSubfolders: boolean): boolean {
  const prefix = folder === '' ? '' : `${folder}/`
  if (!path.startsWith(prefix)) {
    return false
  }
  return includeSubfolders || !path.slice(prefix.length).includes('/')
}

/** The folders pasted files land in, where a file is never loose. */
function attachmentFolders(): string[] {
  const own = getVaultLayout().attachmentFolder
  return own === null || own === '' ? [ASSETS_DIR] : [ASSETS_DIR, own]
}

/**
 * The spellings an indexed reference to `path` may have: the exact path, or
 * the bare file name a wiki embed stores (the same rule as
 * `assetReferenceMatches`).
 */
function referenceSpellings(path: string): [string, string] {
  return [path, path.slice(path.lastIndexOf('/') + 1)]
}

/**
 * The loose files of a folder (and its subfolders, when asked), newest
 * first: attachments no note references, outside the attachment folders.
 * A folder page shows them as cards beside its notes. One catalog read (the
 * host keeps the vault's file catalog) and one indexed query per batch.
 * A bare-name reference counts for every file with that name, so a file is
 * never shown as loose while a note may embed it. `generation` pins the
 * catalog read to the graph that asked, as every vault read is.
 */
export async function looseFiles(
  folder: string,
  includeSubfolders: boolean,
  generation?: number,
): Promise<LooseFile[]> {
  const excluded = attachmentFolders()
  const candidates = (await listAttachments(generation)).filter((file) => {
    const extension = extensionOf(file.path)
    return (
      !VIEW_EXTENSIONS.has(extension) &&
      underFolder(file.path, folder, includeSubfolders) &&
      !excluded.some((dir) => file.path.startsWith(`${dir}/`))
    )
  })
  const referenced = new Set<string>()
  for (let start = 0; start < candidates.length; start += QUERY_CHUNK) {
    const spellings = candidates
      .slice(start, start + QUERY_CHUNK)
      .flatMap((file) => referenceSpellings(file.path))
    const rows = await db
      .selectFrom('assets')
      .where('assetPath', 'in', spellings)
      .select('assetPath')
      .distinct()
      .execute()
    for (const row of rows) {
      referenced.add(row.assetPath)
    }
  }
  return candidates
    .filter((file) => !referenceSpellings(file.path).some((spelling) => referenced.has(spelling)))
    .map((file): LooseFile => {
      const name = file.path.slice(file.path.lastIndexOf('/') + 1)
      const extension = extensionOf(name)
      return {
        path: file.path,
        name,
        extension,
        kind: KIND_BY_EXTENSION[extension] ?? 'other',
        size: file.size,
        modifiedMs: file.modifiedMs,
      }
    })
    .sort((a, b) => b.modifiedMs - a.modifiedMs || a.path.localeCompare(b.path))
}

/**
 * Can a watcher batch have changed a folder's loose files? Only a file
 * appearing, changing or going in it can: the batch's note changes move the
 * index, and the index queries refresh on their own.
 */
export function looseFilesAffectedBy(
  changes: readonly FileChange[],
  folder: string,
  includeSubfolders: boolean,
): boolean {
  return changes.some(
    (change) =>
      isAttachmentPath(change.path) && underFolder(change.path, folder, includeSubfolders),
  )
}
