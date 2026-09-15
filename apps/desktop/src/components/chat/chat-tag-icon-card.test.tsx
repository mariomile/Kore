import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { AssistantPart, NoteToolResult } from '@reflect/core'

const applyTagIcon = vi.hoisted(() => vi.fn<() => Promise<void>>())
const recordDecision = vi.hoisted(() => vi.fn())
const bindNoteEditDecision = vi.hoisted(() => vi.fn(() => recordDecision))
const navigate = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/use-apply-tag-icon', () => ({ useApplyTagIcon: () => applyTagIcon }))
vi.mock('@/hooks/use-apply-note-edit', () => ({ useApplyNoteEdit: () => vi.fn() }))
vi.mock('@/providers/chat-provider', () => ({
  useChatSession: () => ({ bindNoteEditDecision }),
}))
vi.mock('@/routing/router', () => ({ useRouter: () => ({ navigate }) }))
vi.mock('@/hooks/use-note-link-navigation', () => ({ useNoteLinkNavigation: () => vi.fn() }))

const { ChatToolChip } = await import('./chat-tool-chip')

type IconResult = Extract<NoteToolResult, { tool: 'setTagIcon' }>

function iconPart(overrides: Partial<IconResult> = {}): Extract<AssistantPart, { kind: 'tool' }> {
  return {
    kind: 'tool',
    call: { tool: 'setTagIcon', toolCallId: 't1', tag: 'company' },
    result: {
      tool: 'setTagIcon',
      toolCallId: 't1',
      tag: 'company',
      path: 'tags/company.md',
      icon: 'icon:buildings',
      previousIcon: null,
      error: null,
      decision: 'pending',
      ...overrides,
    },
    error: null,
  }
}

beforeEach(() => {
  applyTagIcon.mockReset()
  applyTagIcon.mockResolvedValue(undefined)
  recordDecision.mockClear()
  bindNoteEditDecision.mockClear()
  navigate.mockClear()
})

describe('ChatTagIconCard', () => {
  it('shows the current and proposed icon, and accepts from the keyboard', async () => {
    const view = await render(<ChatToolChip part={iconPart()} turnStatus="done" />)
    await expect.element(view.getByText('No icon')).toBeVisible()
    await expect.element(view.getByText('buildings')).toBeVisible()

    const card = view.getByRole('group', { name: 'Proposed an icon for Company' })
    const element = card.element()
    if (!(element instanceof HTMLElement)) {
      throw new TypeError('expected an HTMLElement')
    }
    element.focus()
    await userEvent.keyboard('{Enter}')

    await vi.waitFor(() => {
      expect(applyTagIcon).toHaveBeenCalledWith({
        tag: 'company',
        icon: 'icon:buildings',
        previousIcon: null,
      })
      expect(bindNoteEditDecision).toHaveBeenCalledWith('t1')
      expect(recordDecision).toHaveBeenCalledWith('accepted')
    })
    await view.unmount()
  })

  it('rejects without writing, and keeps a failed accept pending with its reason', async () => {
    const rejected = await render(<ChatToolChip part={iconPart()} turnStatus="done" />)
    await rejected.getByRole('button', { name: 'Reject' }).click()
    expect(recordDecision).toHaveBeenCalledWith('rejected')
    expect(applyTagIcon).not.toHaveBeenCalled()
    await rejected.unmount()

    recordDecision.mockClear()
    applyTagIcon.mockRejectedValue(new Error('The tag’s icon changed since this was proposed.'))
    const failed = await render(<ChatToolChip part={iconPart()} turnStatus="done" />)
    await failed.getByRole('button', { name: 'Accept' }).click()
    await expect.element(failed.getByRole('alert')).toHaveTextContent('icon changed')
    expect(recordDecision).not.toHaveBeenCalled()
    await expect.element(failed.getByRole('button', { name: 'Accept' })).toBeVisible()
    await failed.unmount()
  })

  it('renders a refusal as a plain chip, and the tag listings as count chips', async () => {
    const refused = await render(
      <ChatToolChip
        part={iconPart({ path: '', icon: null, error: 'Not an icon in this app.' })}
        turnStatus="done"
      />,
    )
    await expect.element(refused.getByText(/Not an icon in this app/)).toBeVisible()
    expect(refused.getByRole('group').query()).toBeNull()
    await refused.unmount()

    const listed = await render(
      <ChatToolChip
        part={{
          kind: 'tool',
          call: { tool: 'tagIcons', toolCallId: 'l1' },
          result: { tool: 'tagIcons', toolCallId: 'l1', count: 217 },
          error: null,
        }}
        turnStatus="done"
      />,
    )
    await expect.element(listed.getByText(/Looked up the app’s icons · 217 icons/)).toBeVisible()
    await listed.unmount()
  })
})
