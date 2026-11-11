import { TaskStaleError } from '@kore/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { moveTask, projectSections, undoTaskMoves } from './task-move'

const openSession = vi.hoisted(() => vi.fn())
vi.mock('@/editor/open-documents', () => ({ openSession }))

const disk = vi.hoisted(() => new Map<string, string>())
const readNote = vi.hoisted(() => vi.fn())
const writeNote = vi.hoisted(() => vi.fn())
vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  readNote,
  writeNote,
}))

const SOURCE = 'daily.md'
const TARGET = 'Kore/Kore.md'

/** A task ref for the line starting `- [ ] <text>` in the note: raw runs to the line's end. */
function taskIn(notePath: string, text: string) {
  const source = disk.get(notePath) ?? ''
  const markerOffset = source.indexOf(`[ ] ${text}`)
  const end = source.indexOf('\n', markerOffset)
  return { notePath, markerOffset, raw: source.slice(markerOffset, end === -1 ? undefined : end) }
}

beforeEach(() => {
  disk.clear()
  openSession.mockReset().mockReturnValue(null)
  readNote.mockReset().mockImplementation(async (path: string) => {
    const content = disk.get(path)
    if (content === undefined) {
      throw new Error(`missing ${path}`)
    }
    return content
  })
  writeNote.mockReset().mockImplementation(async (path: string, content: string) => {
    disk.set(path, content)
  })
})

describe('moveTask', () => {
  it('moves the line, with its date and subtasks, under a section of the project', async () => {
    disk.set(SOURCE, '- [ ] ship it 📅 2026-11-10\n  - [ ] write notes\n- [ ] stays\n')
    disk.set(TARGET, '# Kore\n\n## Doing\n\n- [ ] other\n\n## Later\n')

    await moveTask(taskIn(SOURCE, 'ship it'), { notePath: TARGET, section: 'Doing' }, 1)

    expect(disk.get(SOURCE)).toBe('- [ ] stays\n')
    const target = disk.get(TARGET)!
    expect(target).toContain('- [ ] ship it 📅 2026-11-10\n  - [ ] write notes')
    expect(target.indexOf('ship it')).toBeLessThan(target.indexOf('## Later'))
  })

  it('undo puts both notes back as they were', async () => {
    const before = { source: '- [ ] ship it\n- [ ] stays\n', target: '# Kore\n' }
    disk.set(SOURCE, before.source)
    disk.set(TARGET, before.target)

    const move = await moveTask(taskIn(SOURCE, 'ship it'), { notePath: TARGET, section: null }, 1)
    await undoTaskMoves([move], 1)

    expect(disk.get(SOURCE)).toBe(before.source)
    expect(disk.get(TARGET)).toBe(before.target)
  })

  it('refuses to undo over a later edit, and loses nothing', async () => {
    disk.set(SOURCE, '- [ ] ship it\n')
    disk.set(TARGET, '# Kore\n')
    const move = await moveTask(taskIn(SOURCE, 'ship it'), { notePath: TARGET, section: null }, 1)
    disk.set(TARGET, `${disk.get(TARGET)}- [ ] typed after\n`)

    await expect(undoTaskMoves([move], 1)).rejects.toBeInstanceOf(TaskStaleError)
    expect(disk.get(TARGET)).toContain('typed after')
  })

  it('leaves the source untouched when the paste fails', async () => {
    const original = '- [ ] ship it\n- [ ] stays\n'
    disk.set(SOURCE, original)
    disk.set(TARGET, '# Kore\n')
    writeNote.mockImplementation(async (path: string, content: string) => {
      if (path === TARGET) {
        throw new Error('disk full')
      }
      disk.set(path, content)
    })

    await expect(
      moveTask(taskIn(SOURCE, 'ship it'), { notePath: TARGET, section: null }, 1),
    ).rejects.toThrow('disk full')
    expect(disk.get(SOURCE)).toBe(original)
    expect(disk.get(TARGET)).toBe('# Kore\n')
  })

  it('takes the copy back out of the target when the cut fails', async () => {
    disk.set(SOURCE, '- [ ] ship it\n')
    disk.set(TARGET, '# Kore\n')
    writeNote.mockImplementation(async (path: string, content: string) => {
      if (path === SOURCE) {
        throw new Error('locked')
      }
      disk.set(path, content)
    })

    await expect(
      moveTask(taskIn(SOURCE, 'ship it'), { notePath: TARGET, section: null }, 1),
    ).rejects.toThrow('locked')
    expect(disk.get(SOURCE)).toBe('- [ ] ship it\n')
    expect(disk.get(TARGET)).toBe('# Kore\n')
  })

  it('moves within one note to another of its sections', async () => {
    disk.set(TARGET, '# Kore\n\n## Doing\n\n- [ ] ship it\n\n## Done\n\n- [ ] old\n')

    const move = await moveTask(taskIn(TARGET, 'ship it'), { notePath: TARGET, section: 'Done' }, 1)

    expect(move.rewrites).toHaveLength(1)
    const after = disk.get(TARGET)!
    expect(after.indexOf('ship it')).toBeGreaterThan(after.indexOf('## Done'))
  })
})

describe('projectSections', () => {
  it("lists the note's headings, and none when it can't be read", async () => {
    disk.set(TARGET, '# Kore\n\n## Doing\n\n## Later\n')
    await expect(projectSections(TARGET)).resolves.toEqual(['Doing', 'Later'])
    await expect(projectSections('missing.md')).resolves.toEqual([])
  })
})
