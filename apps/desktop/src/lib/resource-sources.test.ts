import { parseNote } from '@reflect/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNoteSession, type NoteSession } from '@/editor/note-session'
import { registerOpenDocument } from '@/editor/open-documents'
import { appendResourceSource } from './resource-sources'

const path = 'notes/resource.md'
const cleanups: Array<() => void> = []

async function openCard(): Promise<{ session: NoteSession; disk: () => string }> {
  let disk = '---\nsources: ["[[notes/first]]"]\n---\n# Card\n'
  const session = createNoteSession({
    path,
    io: {
      read: async () => disk,
      write: async (_path, contents) => {
        disk = contents
      },
    },
    classify: () => 'exact',
    onSnapshot: () => {},
    applyContent: () => {},
    saveDebounceMs: 60_000,
  })
  cleanups.push(registerOpenDocument({ session }), () => session.dispose())
  session.load()
  await vi.waitFor(() => expect(session.liveContent()).not.toBeNull())
  return { session, disk: () => disk }
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe('resource source updates', () => {
  it('commits sources alongside dirty annotations through the live session', async () => {
    const card = await openCard()
    card.session.editorChanged('# Card\n\nUnsaved annotation\n')
    await appendResourceSource(path, '[[notes/second]]', 3, () => false)
    expect(card.disk()).toContain('Unsaved annotation')
    expect(parseNote({ path, source: card.disk() }).frontmatter['sources']).toEqual([
      '[[notes/first]]',
      '[[notes/second]]',
    ])
    expect(card.session.content()).toBe(card.disk())
    expect(card.session.isDirty()).toBe(false)
  })

  it('refuses a stale graph before touching an owner registered at the same path', async () => {
    const card = await openCard()
    const original = card.session.content()
    await expect(appendResourceSource(path, '[[notes/old-graph]]', 2, () => true)).rejects.toThrow(
      'origin session has ended',
    )
    expect(card.session.content()).toBe(original)
    expect(card.disk()).toBe(original)
  })
})
