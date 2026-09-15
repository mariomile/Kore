import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { AssistantPart, NoteToolResult } from '@reflect/core'

const applyNoteEdit = vi.hoisted(() => vi.fn<() => Promise<void>>())
const recordDecision = vi.hoisted(() => vi.fn())
const bindNoteEditDecision = vi.hoisted(() => vi.fn(() => recordDecision))
const navigateNoteLink = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/use-apply-note-edit', () => ({ useApplyNoteEdit: () => applyNoteEdit }))
vi.mock('@/providers/chat-provider', () => ({
  useChatSession: () => ({ bindNoteEditDecision }),
}))
vi.mock('@/hooks/use-note-row', () => ({
  useNoteRow: (path: string) => (path === 'notes/atlas.md' ? { title: 'Atlas' } : null),
}))
vi.mock('@/hooks/use-note-link-navigation', () => ({
  useNoteLinkNavigation: () => navigateNoteLink,
}))

const { ChatToolChip } = await import('./chat-tool-chip')

type EditResult = Extract<NoteToolResult, { tool: 'editNote' }>

function editPart(overrides: Partial<EditResult> = {}): Extract<AssistantPart, { kind: 'tool' }> {
  return {
    kind: 'tool',
    call: { tool: 'editNote', toolCallId: 'e1', path: 'notes/atlas.md' },
    result: {
      tool: 'editNote',
      toolCallId: 'e1',
      path: 'notes/atlas.md',
      oldText: '- call the surveyor',
      newText: '- [ ] call the surveyor [[House]]',
      error: null,
      decision: 'pending',
      ...overrides,
    },
    error: null,
  }
}

/** Focus the card the way a Tab would land on it, so the key handler fires on it. */
function focusElement(element: Element): void {
  if (!(element instanceof HTMLElement)) {
    throw new TypeError('expected an HTMLElement')
  }
  element.focus()
}

beforeEach(() => {
  applyNoteEdit.mockReset()
  applyNoteEdit.mockResolvedValue(undefined)
  recordDecision.mockClear()
  bindNoteEditDecision.mockClear()
  navigateNoteLink.mockClear()
})

describe('ChatNotePatchCard', () => {
  it('shows the hunk as a diff and accepts from the keyboard through the apply channel', async () => {
    const view = await render(<ChatToolChip part={editPart()} turnStatus="done" />)
    await expect.element(view.getByText(/^−\s*- call the surveyor$/)).toBeVisible()
    await expect
      .element(view.getByText(/^\+\s*- \[ \] call the surveyor \[\[House\]\]$/))
      .toBeVisible()

    const card = view.getByRole('group', { name: 'Proposed edit to Atlas' })
    focusElement(card.element())
    await userEvent.keyboard('{Enter}')

    await vi.waitFor(() => {
      expect(applyNoteEdit).toHaveBeenCalledWith('notes/atlas.md', {
        oldText: '- call the surveyor',
        newText: '- [ ] call the surveyor [[House]]',
      })
      expect(recordDecision).toHaveBeenCalledWith('accepted')
    })
    await view.unmount()
  })

  it('rejects with Backspace without touching the note', async () => {
    const view = await render(<ChatToolChip part={editPart()} turnStatus="done" />)
    focusElement(view.getByRole('group').element())
    await userEvent.keyboard('{Backspace}')
    expect(bindNoteEditDecision).toHaveBeenCalledWith('e1')
    expect(recordDecision).toHaveBeenCalledWith('rejected')
    expect(applyNoteEdit).not.toHaveBeenCalled()
    await view.unmount()
  })

  it('keeps the proposal pending and shows the failure when the apply refuses', async () => {
    applyNoteEdit.mockRejectedValue(new Error('The note changed since this edit was proposed.'))
    const view = await render(<ChatToolChip part={editPart()} turnStatus="done" />)
    await view.getByRole('button', { name: 'Accept' }).click()
    await expect.element(view.getByRole('alert')).toHaveTextContent('The note changed')
    expect(recordDecision).not.toHaveBeenCalled()
    await expect.element(view.getByRole('button', { name: 'Accept' })).toBeVisible()
    await view.unmount()
  })

  it('holds the buttons while the turn streams and hides them once decided', async () => {
    const streaming = await render(<ChatToolChip part={editPart()} turnStatus="streaming" />)
    expect(streaming.getByRole('button', { name: 'Accept' }).query()).toBeNull()
    await streaming.unmount()

    const applied = await render(
      <ChatToolChip part={editPart({ decision: 'accepted' })} turnStatus="done" />,
    )
    await expect
      .element(applied.getByRole('group', { name: 'Applied edit to Atlas' }))
      .toBeVisible()
    expect(applied.getByRole('button', { name: 'Accept' }).query()).toBeNull()
    expect(applied.getByRole('button', { name: 'Reject' }).query()).toBeNull()
    await applied.unmount()
  })

  it('renders a refused proposal as a plain chip with the reason', async () => {
    const view = await render(
      <ChatToolChip
        part={editPart({ oldText: '', newText: '', error: 'This note is marked private.' })}
        turnStatus="done"
      />,
    )
    await expect.element(view.getByText(/This note is marked private/)).toBeVisible()
    expect(view.getByRole('group').query()).toBeNull()
    await view.unmount()
  })
})
