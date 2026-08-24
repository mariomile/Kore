import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNoteWithTitle, getTagType } from '@reflect/core'
import { logCompanyCapture, commandsForGraphRole } from './company-capture'
import { ensureCompanyGraphSeed } from './company-graph-seed'
import { createTypedCollectionNote } from './tags/create-collection-note'

vi.mock('./company-graph-seed', () => ({
  ensureCompanyGraphSeed: vi.fn(async () => {}),
}))
vi.mock('./tags/create-collection-note', () => ({
  createTypedCollectionNote: vi.fn(async () => 'notes/untitled.md'),
}))
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  getTagType: vi.fn(async () => null),
  createNoteWithTitle: vi.fn(async (title: string) => `notes/${title.toLowerCase()}.md`),
}))

const seedMock = vi.mocked(ensureCompanyGraphSeed)
const typedMock = vi.mocked(createTypedCollectionNote)
const typeMock = vi.mocked(getTagType)
const titledMock = vi.mocked(createNoteWithTitle)

beforeEach(() => {
  vi.clearAllMocks()
  typeMock.mockResolvedValue(null)
  typedMock.mockResolvedValue('notes/untitled.md')
  titledMock.mockImplementation(async (title: string) => `notes/${title.toLowerCase()}.md`)
})

describe('logCompanyCapture', () => {
  it('seeds types and births an untitled decision from the template', async () => {
    const path = await logCompanyCapture('decision', 4)
    expect(seedMock).toHaveBeenCalledWith(4)
    expect(typedMock).toHaveBeenCalledWith(
      'decision',
      4,
      { status: 'proposed', decided: expect.any(String) },
      null,
      expect.objectContaining({ title: 'Decision' }),
    )
    expect(titledMock).not.toHaveBeenCalled()
    expect(path).toBe('notes/untitled.md')
  })

  it('writes a titled decision with an optional backlink body', async () => {
    const path = await logCompanyCapture('decision', 4, 'Ship pricing', 'From [[Standup]]')
    expect(titledMock).toHaveBeenCalledWith(
      'Ship pricing',
      4,
      '- Type: #decision\n\nFrom [[Standup]]',
    )
    expect(typedMock).not.toHaveBeenCalled()
    expect(path).toBe('notes/ship pricing.md')
  })
})

describe('commandsForGraphRole', () => {
  it('hides company capture on personal and unmarked graphs', () => {
    const commands = [
      { id: 'nav.today' },
      { id: 'capture.logDecision' },
      { id: 'capture.logMeeting' },
    ]
    expect(commandsForGraphRole(commands, null).map((command) => command.id)).toEqual(['nav.today'])
    expect(commandsForGraphRole(commands, 'personal').map((command) => command.id)).toEqual([
      'nav.today',
    ])
    expect(commandsForGraphRole(commands, 'company').map((command) => command.id)).toEqual([
      'nav.today',
      'capture.logDecision',
      'capture.logMeeting',
    ])
  })
})
