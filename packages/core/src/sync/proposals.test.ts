import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { acceptProposal, describeProposal, listProposals, type Proposal } from './proposals'

function proposal(tool: string, args: Record<string, unknown>): Proposal {
  return {
    id: '1762687200000-abc',
    at: 1762687200000,
    agent: { name: 'Grok', email: 'grok@agents.kore' },
    call: { tool, arguments: args },
  }
}

afterEach(() => {
  setBridge(null)
})

describe('proposals', () => {
  it('lists and decides through the bundled CLI', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce([proposal('capture', { text: 'buy milk' })])
      .mockResolvedValueOnce({ id: '1762687200000-abc', accepted: true, result: {} })
    setBridge({ invoke, listen: async () => () => {} })

    const waiting = await listProposals(3)
    expect(waiting[0]?.agent.name).toBe('Grok')
    await acceptProposal(3, waiting[0]?.id ?? '')
    expect(invoke).toHaveBeenNthCalledWith(1, 'proposals_run', {
      generation: 3,
      action: 'list',
      id: null,
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'proposals_run', {
      generation: 3,
      action: 'accept',
      id: '1762687200000-abc',
    })
  })

  it('previews an edit as the text it removes and the text it adds', () => {
    expect(
      describeProposal(proposal('edit_note', { note: 'Atlas', oldText: 'v1', newText: 'v2' })),
    ).toEqual({
      action: 'Edit',
      note: 'Atlas',
      lines: [
        { kind: 'remove', text: 'v1' },
        { kind: 'add', text: 'v2' },
      ],
    })
    expect(
      describeProposal(proposal('edit_note', { note: 'Atlas', oldText: '', newText: 'tail' }))
        .lines,
    ).toEqual([{ kind: 'add', text: 'tail' }])
  })

  it("names today's note when a capture or a fact has no target", () => {
    expect(describeProposal(proposal('capture', { text: 'call Anna', task: true }))).toEqual({
      action: "Add to today's note",
      note: null,
      lines: [{ kind: 'add', text: '[ ] call Anna' }],
    })
    expect(describeProposal(proposal('remember', { fact: 'x', note: 'Facts' })).action).toBe(
      'Remember in',
    )
  })

  it('previews properties, tags and a tool it does not know', () => {
    expect(
      describeProposal(
        proposal('set_properties', { note: 'A', set: { stage: 'lead' }, unset: ['old'] }),
      ).lines,
    ).toEqual([
      { kind: 'add', text: 'stage: lead' },
      { kind: 'remove', text: 'old' },
    ])
    expect(describeProposal(proposal('untag_note', { note: 'A', tag: 'x' })).lines).toEqual([
      { kind: 'remove', text: '#x' },
    ])
    expect(describeProposal(proposal('future_tool', { a: 1 }))).toEqual({
      action: 'future_tool',
      note: null,
      lines: [{ kind: 'detail', text: 'a: 1' }],
    })
  })

  it('shows every argument the tool lines leave out, so nothing accepted goes unread', () => {
    expect(
      describeProposal(
        proposal('remember', { fact: 'x', confidence: 0.4, previously: 'y', agent: 'Bot' }),
      ).lines,
    ).toEqual([
      { kind: 'add', text: 'x' },
      { kind: 'detail', text: 'confidence: 0.4' },
      { kind: 'detail', text: 'previously: y' },
      { kind: 'detail', text: 'agent: Bot' },
    ])
    expect(
      describeProposal(proposal('create_note', { title: 'T', properties: { stage: 'lead' } }))
        .lines,
    ).toEqual([{ kind: 'detail', text: 'properties: {"stage":"lead"}' }])
    const tools = [
      'capture',
      'append_to_note',
      'edit_note',
      'create_note',
      'set_properties',
      'tag_note',
      'untag_note',
      'complete_task',
      'remember',
    ]
    for (const tool of tools) {
      const { lines } = describeProposal(proposal(tool, { added_later: 'visible' }))
      expect(lines, tool).toContainEqual({ kind: 'detail', text: 'added_later: visible' })
    }
  })
})
