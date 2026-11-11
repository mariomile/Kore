import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import type { NoteBlame } from '@reflect/core'
import '@/test-utils/locator'
import { LineAuthorShading } from './line-author-shading'
import { NoteEditor } from './note-editor'

const gitBlame = vi.hoisted(() => vi.fn())
vi.mock('@reflect/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@reflect/core')>()),
  gitBlame,
}))

const HEADER = '---\ntags: [plan]\n---\n'
const BODY = 'Mine\n\nWritten by Grok\n'

// Header lines 1-3 and the owner's "Mine" from one commit, Grok's line from another.
const BLAME: NoteBlame = {
  hunks: [
    { startLine: 1, lines: 5, commit: 'aaa' },
    { startLine: 6, lines: 1, commit: 'bbb' },
  ],
  commits: {
    aaa: { timeMs: 1, authorName: 'Mario', authorEmail: 'm@example.com', trailers: [] },
    bbb: {
      timeMs: 2,
      authorName: 'Grok',
      authorEmail: 'grok@agents.kore',
      trailers: [{ key: 'Kore-Agent', value: 'Grok' }],
    },
  },
}

afterEach(() => {
  gitBlame.mockReset()
})

async function renderNote(enabled: boolean) {
  return await render(
    <NoteEditor initialContent={BODY}>
      <LineAuthorShading enabled={enabled} path="notes/plan.md" generation={3} header={HEADER} />
    </NoteEditor>,
  )
}

describe('LineAuthorShading', () => {
  it('marks the agent’s line, leaves the owner’s plain, and blames header plus body', async () => {
    gitBlame.mockResolvedValue(BLAME)
    await renderNote(true)

    const agentLine = page.locate('.ProseMirror p.kore-line-author')
    await expect.element(agentLine).toHaveTextContent('Written by Grok')
    await expect.element(agentLine).toHaveAttribute('data-line-author', 'agent')
    expect(document.querySelectorAll('.ProseMirror .kore-line-author')).toHaveLength(1)
    expect(gitBlame).toHaveBeenCalledWith('notes/plan.md', HEADER + BODY, 3)
  })

  it('runs no blame while the setting is off', async () => {
    gitBlame.mockResolvedValue(BLAME)
    await renderNote(false)
    await expect.element(page.locate('.ProseMirror p').first()).toBeInTheDocument()
    expect(gitBlame).not.toHaveBeenCalled()
    expect(document.querySelector('.kore-line-author')).toBeNull()
  })

  it('shows nothing when the vault has no backup to blame', async () => {
    gitBlame.mockRejectedValue(new Error('sync is not set up for this vault'))
    await renderNote(true)
    await vi.waitFor(() => expect(gitBlame).toHaveBeenCalled())
    expect(document.querySelector('.kore-line-author')).toBeNull()
  })
})
