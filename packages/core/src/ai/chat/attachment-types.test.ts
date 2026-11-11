import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ATTACHMENT_KINDS, chatAttachmentMediaType } from './attachment-types'

describe('chatAttachmentMediaType', () => {
  it('resolves documents by extension and keeps images, refusing the rest', () => {
    expect(chatAttachmentMediaType('notes.md', '')).toBe('text/markdown')
    expect(chatAttachmentMediaType('Data.CSV', 'application/vnd.ms-excel')).toBe('text/csv')
    expect(chatAttachmentMediaType('paper.pdf', 'application/pdf')).toBe('application/pdf')
    expect(chatAttachmentMediaType('photo.heic', 'image/heic')).toBe('image/heic')
    expect(chatAttachmentMediaType('deck.pptx', 'application/vnd.ms-powerpoint')).toBeNull()
  })
})

describe('the Rust attachment store', () => {
  // The Rust side keeps its own closed extension lists (they are the security
  // boundary for what the asset protocol serves); they must match this table.
  const rust = readFileSync(
    new URL('../../../../../apps/desktop/src-tauri/src/fs/chat_attachments.rs', import.meta.url),
    'utf8',
  )
  const rustList = (name: string): string[] => {
    const match = new RegExp(String.raw`const ${name}: \[&str; \d+\] = \[([^\]]*)\]`).exec(rust)
    return [...(match?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((found) => found[1] ?? '')
  }
  const extensions = (channels: readonly string[], all: boolean): string[] =>
    ATTACHMENT_KINDS.filter((kind) => channels.includes(kind.channel)).flatMap((kind) =>
      all ? [...kind.extensions] : [kind.extensions[0]],
    )

  it('accepts every extension core writes, and nothing core does not know', () => {
    const raster = rustList('RASTER_EXTENSIONS')
    const documents = rustList('DOCUMENT_EXTENSIONS')
    expect(raster.length).toBeGreaterThan(0)
    expect(documents.length).toBeGreaterThan(0)
    expect(raster).toEqual(expect.arrayContaining(extensions(['image'], false)))
    expect(extensions(['image'], true)).toEqual(expect.arrayContaining(raster))
    expect(documents).toEqual(expect.arrayContaining(extensions(['document', 'text'], false)))
    expect(extensions(['document', 'text'], true)).toEqual(expect.arrayContaining(documents))
  })
})
