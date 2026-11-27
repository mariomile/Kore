import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNoteSession } from './note-session'

/**
 * `editorDirtied` hands the session a reader instead of the markdown, so a
 * long note is serialized once typing pauses rather than on every keystroke.
 * These pin that nothing ever acts on a buffer that misses unread typing.
 */

function harness() {
  let disk = '# Hello\n'
  const writes: string[] = []
  const applied: string[] = []
  /** The live editor's document, as its serializer would return it. */
  let editor = '# Hello\n'
  let editorGone = false
  const reads = { count: 0 }
  let session: ReturnType<typeof createNoteSession> | null = null
  session = createNoteSession({
    path: 'notes/a.md',
    io: {
      read: async () => disk,
      write: async (_path, contents) => {
        writes.push(contents)
        disk = contents
      },
    },
    classify: () => 'exact',
    onSnapshot: () => {},
    applyContent: (markdown) => {
      applied.push(markdown)
      editor = markdown
      // The real editor reports the reload synchronously, from inside the call.
      session?.editorDirtied(read)
    },
    saveDebounceMs: 800,
  })
  const read = (): string | null => {
    reads.count++
    return editorGone ? null : editor
  }
  return {
    session,
    writes,
    applied,
    reads,
    type: (markdown: string) => {
      editor = markdown
      session.editorDirtied(read)
    },
    setDisk: (contents: string) => {
      disk = contents
    },
    unmountEditor: () => {
      editorGone = true
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

async function loaded(h: ReturnType<typeof harness>): Promise<void> {
  h.session.load()
  await vi.advanceTimersByTimeAsync(0)
}

describe('lazy editor reads', () => {
  it('serializes once typing pauses, not on every keystroke', async () => {
    const h = harness()
    await loaded(h)
    for (const text of ['# Hello!\n', '# Hello!!\n', '# Hello!!!\n']) {
      h.type(text)
      await vi.advanceTimersByTimeAsync(40)
    }
    expect(h.reads.count).toBe(0)
    await vi.advanceTimersByTimeAsync(150)
    expect(h.reads.count).toBe(1)
    await vi.advanceTimersByTimeAsync(800)
    expect(h.writes).toEqual(['# Hello!!!\n'])
  })

  it('reads at least once a second while typing never pauses', async () => {
    const h = harness()
    await loaded(h)
    for (let key = 0; key < 25; key++) {
      h.type(`# Hello ${key}\n`)
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(h.reads.count).toBeGreaterThanOrEqual(2)
    expect(h.reads.count).toBeLessThanOrEqual(3)
  })

  it('never saves while typing goes on, however slowly each key lands', async () => {
    const h = harness()
    await loaded(h)
    for (let key = 0; key < 30; key++) {
      h.type(`# Hello ${key}\n`)
      await vi.advanceTimersByTimeAsync(120)
    }
    expect(h.writes).toEqual([])
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.writes).toEqual(['# Hello 29\n'])
  })

  it('a flush, content() and isDirty() read pending typing first', async () => {
    const h = harness()
    await loaded(h)
    h.type('# Typed\n')
    expect(h.session.isDirty()).toBe(true)
    h.type('# Typed more\n')
    expect(h.session.content()).toBe('# Typed more\n')
    h.type('# Typed last\n')
    await h.session.flush()
    expect(h.writes.at(-1)).toBe('# Typed last\n')
  })

  it('an external change parks as a conflict instead of replacing unread typing', async () => {
    const h = harness()
    await loaded(h)
    h.type('# Mine\n')
    h.setDisk('# Theirs\n')
    h.session.externalChanged()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.applied).toEqual([])
    expect(h.session.content()).toBe('# Mine\n')
  })

  it('a body transform keeps typing the session had not read yet', async () => {
    const h = harness()
    await loaded(h)
    h.type('# Hello\n\nnew line\n')
    await h.session.commitBodyTransform((full) => `${full}appended\n`)
    expect(h.applied.at(-1)).toBe('# Hello\n\nnew line\nappended\n')
    expect(h.writes.at(-1)).toBe('# Hello\n\nnew line\nappended\n')
  })

  it("the session's own reload is read at once and never dirties the note", async () => {
    const h = harness()
    await loaded(h)
    h.setDisk('# Reloaded\n')
    h.session.externalChanged()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.applied).toEqual(['# Reloaded\n'])
    expect(h.session.isDirty()).toBe(false)
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.writes).toEqual([])
  })

  it('settleEditor reads typing before the editor goes away', async () => {
    const h = harness()
    await loaded(h)
    h.type('# Before close\n')
    h.session.settleEditor()
    h.unmountEditor()
    h.session.dispose()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.writes).toEqual(['# Before close\n'])
  })

  it('a reader whose editor is gone changes nothing', async () => {
    const h = harness()
    await loaded(h)
    h.type('# Lost?\n')
    h.unmountEditor()
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.session.content()).toBe('# Hello\n')
    expect(h.writes).toEqual([])
  })
})
