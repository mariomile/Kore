import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { AssistantPart, NoteToolResult, TagProperty } from '@reflect/core'

const applyTagSchema = vi.hoisted(() => vi.fn<() => Promise<void>>())
const recordDecision = vi.hoisted(() => vi.fn())
const bindNoteEditDecision = vi.hoisted(() => vi.fn(() => recordDecision))
const navigate = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/use-apply-tag-schema', () => ({ useApplyTagSchema: () => applyTagSchema }))
vi.mock('@/hooks/use-apply-tag-icon', () => ({ useApplyTagIcon: () => vi.fn() }))
vi.mock('@/hooks/use-apply-note-edit', () => ({ useApplyNoteEdit: () => vi.fn() }))
vi.mock('@/providers/chat-provider', () => ({
  useChatSession: () => ({ bindNoteEditDecision }),
}))
vi.mock('@/routing/router', () => ({ useRouter: () => ({ navigate }) }))
vi.mock('@/hooks/use-note-link-navigation', () => ({ useNoteLinkNavigation: () => vi.fn() }))

const { ChatToolChip } = await import('./chat-tool-chip')

const AUTHOR: TagProperty = { name: 'Author', key: 'author', type: 'text' }
const READ_ON: TagProperty = { name: 'Read on', key: 'read-on', type: 'date' }

type SchemaResult = Extract<NoteToolResult, { tool: 'setTagSchema' }>

function schemaPart(
  overrides: Partial<SchemaResult> = {},
): Extract<AssistantPart, { kind: 'tool' }> {
  return {
    kind: 'tool',
    call: { tool: 'setTagSchema', toolCallId: 't1', tag: 'book' },
    result: {
      tool: 'setTagSchema',
      toolCallId: 't1',
      tag: 'book',
      path: 'tags/book.md',
      properties: [AUTHOR, READ_ON],
      previousProperties: [AUTHOR],
      renames: [],
      error: null,
      decision: 'pending',
      ...overrides,
    },
    error: null,
  }
}

beforeEach(() => {
  applyTagSchema.mockReset()
  applyTagSchema.mockResolvedValue(undefined)
  recordDecision.mockClear()
  bindNoteEditDecision.mockClear()
  navigate.mockClear()
})

describe('ChatTagSchemaCard', () => {
  it('shows what the proposal adds and keeps, and accepts from the keyboard', async () => {
    const view = await render(<ChatToolChip part={schemaPart()} turnStatus="done" />)
    await expect.element(view.getByText(/Read on \(read-on\) · Date/)).toBeVisible()
    await expect.element(view.getByText(/Author \(author\) · Text/)).toBeVisible()

    const card = view.getByRole('group', { name: 'Proposed properties for Book' })
    const element = card.element()
    if (!(element instanceof HTMLElement)) {
      throw new TypeError('expected an HTMLElement')
    }
    element.focus()
    await userEvent.keyboard('{Enter}')

    await vi.waitFor(() => {
      expect(applyTagSchema).toHaveBeenCalledWith({
        tag: 'book',
        properties: [AUTHOR, READ_ON],
        previousProperties: [AUTHOR],
        renames: [],
      })
      expect(bindNoteEditDecision).toHaveBeenCalledWith('t1')
      expect(recordDecision).toHaveBeenCalledWith('accepted')
    })
    await view.unmount()
  })

  it('spells out a removal and the values a rename would move', async () => {
    const removing = await render(
      <ChatToolChip
        part={schemaPart({ properties: [], previousProperties: [AUTHOR, READ_ON] })}
        turnStatus="done"
      />,
    )
    await expect.element(removing.getByText(/Author \(author\) · Text/)).toBeVisible()
    await expect.element(removing.getByText(/Read on \(read-on\) · Date/)).toBeVisible()
    await removing.unmount()

    const renamed: TagProperty = { name: 'Written by', key: 'written-by', type: 'text' }
    const renaming = await render(
      <ChatToolChip
        part={schemaPart({
          properties: [renamed],
          previousProperties: [AUTHOR],
          renames: [{ from: 'author', to: 'written-by' }],
        })}
        turnStatus="done"
      />,
    )
    await expect.element(renaming.getByText(/was Author \(author\) · Text/)).toBeVisible()
    await expect.element(renaming.getByText(/author → written-by/)).toBeVisible()
    await renaming.unmount()
  })

  it('rejects without writing, and keeps a failed accept pending with its reason', async () => {
    const rejected = await render(<ChatToolChip part={schemaPart()} turnStatus="done" />)
    await rejected.getByRole('button', { name: 'Reject' }).click()
    expect(recordDecision).toHaveBeenCalledWith('rejected')
    expect(applyTagSchema).not.toHaveBeenCalled()
    await rejected.unmount()

    recordDecision.mockClear()
    applyTagSchema.mockRejectedValue(
      new Error('The tag’s properties changed since this was proposed.'),
    )
    const failed = await render(<ChatToolChip part={schemaPart()} turnStatus="done" />)
    await failed.getByRole('button', { name: 'Accept' }).click()
    await expect.element(failed.getByRole('alert')).toHaveTextContent('properties changed')
    expect(recordDecision).not.toHaveBeenCalled()
    await expect.element(failed.getByRole('button', { name: 'Accept' })).toBeVisible()
    await failed.unmount()
  })

  it('renders a refusal as a plain chip with nothing to accept', async () => {
    const refused = await render(
      <ChatToolChip
        part={schemaPart({
          path: '',
          properties: [],
          previousProperties: [],
          error: 'The tag already has exactly this schema.',
        })}
        turnStatus="done"
      />,
    )
    await expect.element(refused.getByText(/already has exactly this schema/)).toBeVisible()
    expect(refused.getByRole('group').query()).toBeNull()
    await refused.unmount()
  })
})
