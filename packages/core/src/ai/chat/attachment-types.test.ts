import { describe, expect, it } from 'vitest'
import { chatAttachmentMediaType } from './attachment-types'

describe('chatAttachmentMediaType', () => {
  it('resolves documents by extension and keeps images, refusing the rest', () => {
    expect(chatAttachmentMediaType('notes.md', '')).toBe('text/markdown')
    expect(chatAttachmentMediaType('Data.CSV', 'application/vnd.ms-excel')).toBe('text/csv')
    expect(chatAttachmentMediaType('paper.pdf', 'application/pdf')).toBe('application/pdf')
    expect(chatAttachmentMediaType('photo.heic', 'image/heic')).toBe('image/heic')
    expect(chatAttachmentMediaType('deck.pptx', 'application/vnd.ms-powerpoint')).toBeNull()
  })
})
