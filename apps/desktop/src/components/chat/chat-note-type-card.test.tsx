import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { AssistantPart, NoteToolResult } from '@reflect/core'

const applyNoteType = vi.hoisted(() => vi.fn<() => Promise<void>>())
const recordDecision = vi.hoisted(() => vi.fn())
const bindNoteEditDecision = vi.hoisted(() => vi.fn(() => recordDecision))
const navigate = vi.hoisted(() => vi.fn())
const navigateNoteLink = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/use-apply-note-type', () => ({ useApplyNoteType: () => applyNoteType }))
vi.mock('@/hooks/use-apply-note-edit', () => ({ useApplyNoteEdit: () => vi.fn() }))
vi.mock('@/providers/chat-provider', () => ({
  useChatSession: () => ({ bindNoteEditDecision }),
}))
vi.mock('@/routing/router', () => ({ useRouter: () => ({ navigate }) }))
vi.mock('@/hooks/use-note-link-navigation', () => ({
  useNoteLinkNavigation: () => navigateNoteLink,
}))

const { ChatToolChip } = await import('./chat-tool-chip')

type TypeResult = Extract<NoteToolResult, { tool: 'setNoteType' }>

function typePart(overrides: Partial<TypeResult> = {}): Extract<AssistantPart, { kind: 'tool' }> {
  return {
    kind: 'tool',
    call: {
      tool: 'setNoteType',
      toolCallId: 'n1',
      path: 'notes/The Dispossessed.md',
      tag: 'book',
    },
    result: {
      tool: 'setNoteType',
      toolCallId: 'n1',
      path: 'notes/The Dispossessed.md',
      tag: 'book',
      remove: false,
      error: null,
      decision: 'pending',
      ...overrides,
    },
    error: null,
  }
}

beforeEach(() => {
  applyNoteType.mockReset()
  applyNoteType.mockResolvedValue(undefined)
  recordDecision.mockClear()
  bindNoteEditDecision.mockClear()
  navigate.mockClear()
  navigateNoteLink.mockClear()
})

describe('ChatNoteTypeCard', () => {
  it('names the note and the tag, and accepts from the keyboard', async () => {
    const view = await render(<ChatToolChip part={typePart()} turnStatus="done" />)
    await expect.element(view.getByText('#book')).toBeVisible()
    await expect.element(view.getByText('Add')).toBeVisible()

    const card = view.getByRole('group', { name: 'Proposed a type for The Dispossessed' })
    const element = card.element()
    if (!(element instanceof HTMLElement)) {
      throw new TypeError('expected an HTMLElement')
    }
    element.focus()
    await userEvent.keyboard('{Enter}')

    await vi.waitFor(() => {
      expect(applyNoteType).toHaveBeenCalledWith({
        path: 'notes/The Dispossessed.md',
        tag: 'book',
        remove: false,
      })
      expect(recordDecision).toHaveBeenCalledWith('accepted')
    })
    await view.unmount()
  })

  it('reads as a removal when the proposal takes the tag off', async () => {
    const view = await render(<ChatToolChip part={typePart({ remove: true })} turnStatus="done" />)
    await expect
      .element(view.getByRole('group', { name: 'Proposed taking a type off The Dispossessed' }))
      .toBeVisible()
    await expect.element(view.getByText('Remove')).toBeVisible()

    await view.getByRole('button', { name: 'Accept' }).click()
    await vi.waitFor(() => {
      expect(applyNoteType).toHaveBeenCalledWith({
        path: 'notes/The Dispossessed.md',
        tag: 'book',
        remove: true,
      })
    })
    await view.unmount()
  })

  it('rejects without writing, and keeps a failed accept pending with its reason', async () => {
    const rejected = await render(<ChatToolChip part={typePart()} turnStatus="done" />)
    await rejected.getByRole('button', { name: 'Reject' }).click()
    expect(recordDecision).toHaveBeenCalledWith('rejected')
    expect(applyNoteType).not.toHaveBeenCalled()
    await rejected.unmount()

    recordDecision.mockClear()
    applyNoteType.mockRejectedValue(new Error('The note’s tags changed since this was proposed.'))
    const failed = await render(<ChatToolChip part={typePart()} turnStatus="done" />)
    await failed.getByRole('button', { name: 'Accept' }).click()
    await expect.element(failed.getByRole('alert')).toHaveTextContent('tags changed')
    expect(recordDecision).not.toHaveBeenCalled()
    await failed.unmount()
  })

  it('renders a refusal as a plain chip with nothing to accept', async () => {
    const refused = await render(
      <ChatToolChip
        part={typePart({ error: 'The note already carries this tag.' })}
        turnStatus="done"
      />,
    )
    await expect.element(refused.getByText(/already carries this tag/)).toBeVisible()
    expect(refused.getByRole('group').query()).toBeNull()
    await refused.unmount()
  })
})
