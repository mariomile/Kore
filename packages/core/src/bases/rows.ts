import { listAttachments, listFiles, readAsset } from '../graph/commands'
import { db } from '../indexing/db'
import { decodeStoredList } from '../tags'
import { parseBaseDate } from './dates'
import { isBasePath } from './embeds'
import type { BaseNoteRow, BasePropertyValue } from './values'

/**
 * Index reads behind Bases: every note as a {@link BaseNoteRow}, and the
 * text of a `.base` file. Five whole-table reads (no per-note queries), so
 * a 5,000-note vault costs one round of IPC whatever the base asks for.
 */

function decodeProperty(value: string, valueType: string): BasePropertyValue {
  switch (valueType) {
    case 'number': {
      const number = Number(value)
      return Number.isFinite(number) ? number : value
    }
    case 'boolean':
      return value === 'true'
    case 'list':
      return decodeStoredList(value) ?? []
    default:
      return value
  }
}

function createdMs(properties: Record<string, BasePropertyValue>, mtime: number): number {
  for (const key of ['created', 'date']) {
    const value = properties[key]
    if (typeof value === 'string') {
      const date = parseBaseDate(value)
      if (date !== null) {
        return date.ms
      }
    }
  }
  return mtime
}

/** Every note and daily note in the active graph, ready for a base. */
export async function loadBaseRows(): Promise<BaseNoteRow[]> {
  const [notes, tags, properties, links, files] = await Promise.all([
    db
      .selectFrom('notes')
      .select(['path', 'title', 'mtime'])
      .where('kind', 'in', ['note', 'daily'])
      .execute(),
    db.selectFrom('tags').select(['notePath', 'tag']).execute(),
    db.selectFrom('noteProperties').select(['notePath', 'key', 'value', 'valueType']).execute(),
    db.selectFrom('backlinks').select(['sourcePath', 'targetPath']).execute(),
    listFiles(),
  ])

  const tagsByPath = new Map<string, string[]>()
  for (const { notePath, tag } of tags) {
    const list = tagsByPath.get(notePath) ?? []
    list.push(tag)
    tagsByPath.set(notePath, list)
  }
  const propertiesByPath = new Map<string, Record<string, BasePropertyValue>>()
  for (const { notePath, key, value, valueType } of properties) {
    const record = propertiesByPath.get(notePath) ?? {}
    record[key] = decodeProperty(value, valueType)
    propertiesByPath.set(notePath, record)
  }
  const outgoing = new Map<string, Set<string>>()
  const incoming = new Map<string, Set<string>>()
  for (const { sourcePath, targetPath } of links) {
    if (sourcePath === null || targetPath === null || sourcePath === targetPath) {
      continue
    }
    outgoing.set(sourcePath, (outgoing.get(sourcePath) ?? new Set()).add(targetPath))
    incoming.set(targetPath, (incoming.get(targetPath) ?? new Set()).add(sourcePath))
  }
  const sizes = new Map(files.map((file) => [file.path, file.size]))

  return notes.map((note) => {
    const noteProperties = propertiesByPath.get(note.path) ?? {}
    return {
      path: note.path,
      title: note.title,
      mtime: note.mtime,
      ctime: createdMs(noteProperties, note.mtime),
      size: sizes.get(note.path) ?? 0,
      tags: tagsByPath.get(note.path) ?? [],
      properties: noteProperties,
      links: [...(outgoing.get(note.path) ?? [])],
      backlinks: [...(incoming.get(note.path) ?? [])],
    }
  })
}

/** The UTF-8 text of a `.base` file, pinned to the graph `generation`. */
export async function readBaseFile(path: string, generation: number): Promise<string> {
  const base64 = await readAsset(path, generation)
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Every `.base` file in the vault, by path. */
export async function listBaseFiles(generation?: number): Promise<string[]> {
  const files = await listAttachments(generation)
  return files
    .map((file) => file.path)
    .filter(isBasePath)
    .sort((left, right) => left.localeCompare(right))
}
