import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import type { AssistantPart } from '@reflect/core'
import { ChatToolChip } from './chat-tool-chip'

const commitProperty = vi.hoisted(() => vi.fn())

vi.mock('@/lib/tags/use-commit-note-property', () => ({
  useCommitNoteProperty: () => commitProperty,
}))
vi.mock('@/hooks/use-note-link-navigation', () => ({
  useNoteLinkNavigation: () => vi.fn(),
}))
const openExternalUrl = vi.hoisted(() => vi.fn())
vi.mock('@/editor/open-external-link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/editor/open-external-link')>()),
  openExternalUrl,
}))

beforeEach(() => {
  commitProperty.mockClear()
})

function setPropertyPart(
  result: Extract<
    NonNullable<Extract<AssistantPart, { kind: 'tool' }>['result']>,
    { tool: 'setProperty' }
  > | null,
): Extract<AssistantPart, { kind: 'tool' }> {
  return {
    kind: 'tool',
    call: { tool: 'setProperty', toolCallId: 'c1', path: 'notes/dune.md', key: 'rating' },
    result,
    error: null,
  }
}

describe('ChatToolChip browse', () => {
  it('labels the settled page by title and reopens it in the built-in browser', async () => {
    const view = await render(
      <ChatToolChip
        part={{
          kind: 'tool',
          call: { tool: 'browse', toolCallId: 'c1', url: 'https://example.com/docs' },
          result: {
            tool: 'browse',
            toolCallId: 'c1',
            url: 'https://example.com/docs/intro',
            title: 'Example Docs',
            error: null,
          },
          error: null,
        }}
      />,
    )

    await expect.element(view.getByText('Browsed')).toBeInTheDocument()
    await view.getByRole('button', { name: 'Example Docs' }).click()
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/docs/intro')
  })

  it('falls back to the host while pending and shows a settled failure', async () => {
    const pending = await render(
      <ChatToolChip
        part={{
          kind: 'tool',
          call: { tool: 'browse', toolCallId: 'c1', url: 'https://example.com/docs' },
          result: null,
          error: null,
        }}
      />,
    )
    await expect.element(pending.getByRole('button', { name: 'example.com' })).toBeInTheDocument()

    const failed = await render(
      <ChatToolChip
        part={{
          kind: 'tool',
          call: { tool: 'readPage', toolCallId: 'c2' },
          result: {
            tool: 'readPage',
            toolCallId: 'c2',
            url: null,
            title: null,
            error: 'no embedded browser is open',
          },
          error: null,
        }}
      />,
    )
    await expect.element(failed.getByText(/no embedded browser is open/)).toBeInTheDocument()
  })
})

describe('ChatToolChip setProperty', () => {
  it('applies a proposed value through the session-safe commit channel', async () => {
    const view = await render(
      <ChatToolChip
        part={setPropertyPart({
          tool: 'setProperty',
          toolCallId: 'c1',
          path: 'notes/dune.md',
          key: 'rating',
          error: null,
          value: 4.5,
        })}
      />,
    )

    await view.getByRole('button', { name: 'Apply' }).click()
    expect(commitProperty).toHaveBeenCalledWith('notes/dune.md', 'rating', 4.5)
    await expect.element(view.getByText('Applied')).toBeInTheDocument()
  })

  it('applies a clear as an unset, and hides Apply on legacy chips with no value', async () => {
    const clearView = await render(
      <ChatToolChip
        part={setPropertyPart({
          tool: 'setProperty',
          toolCallId: 'c1',
          path: 'notes/dune.md',
          key: 'rating',
          error: null,
          value: null,
        })}
      />,
    )
    await clearView.getByRole('button', { name: 'Apply' }).click()
    expect(commitProperty).toHaveBeenCalledWith('notes/dune.md', 'rating', undefined)

    commitProperty.mockClear()
    const legacyView = await render(
      <ChatToolChip
        part={setPropertyPart({
          tool: 'setProperty',
          toolCallId: 'c1',
          path: 'notes/dune.md',
          key: 'rating',
          error: null,
        } as never)}
      />,
    )
    expect(legacyView.getByRole('button', { name: 'Apply' }).query()).toBeNull()
    expect(commitProperty).not.toHaveBeenCalled()
  })
})
