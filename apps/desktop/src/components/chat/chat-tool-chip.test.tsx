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
