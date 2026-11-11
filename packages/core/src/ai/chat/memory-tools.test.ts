import { describe, expect, it, vi } from 'vitest'
import type { BrainCommand, BrainResult } from '../../cyber-brain/script'
import {
  buildMemoryTools,
  MEMORY_EDITS_DISABLED_ERROR,
  MEMORY_KIT_ABSENT_ERROR,
  memoryToolLabel,
} from './memory-tools'

const OPTIONS = { toolCallId: 'call-1', messages: [], context: {} }

function writer(result: BrainResult = { ok: true, output: 'kept', commit: 'abc123' }) {
  return vi.fn(async (_command: BrainCommand): Promise<BrainResult> => result)
}

describe('buildMemoryTools', () => {
  it('runs remember through the kit as a fact by default, without empty fields', async () => {
    const memoryWriteFn = writer()
    const tools = buildMemoryTools({ memoryWriteFn, allowEdits: true })

    const output = await tools.remember.execute?.(
      { text: 'Mario lives in Rome', source: 'chat' },
      OPTIONS,
    )

    expect(output).toEqual({ ok: true, output: 'kept', commit: 'abc123' })
    expect(memoryWriteFn).toHaveBeenCalledWith({
      kind: 'remember',
      memory: 'fact',
      text: 'Mario lives in Rome',
      source: 'chat',
    })
  })

  it('keeps the memory kind apart from the command kind', async () => {
    const memoryWriteFn = writer()
    const tools = buildMemoryTools({ memoryWriteFn, allowEdits: true })

    await tools.remember.execute?.({ text: 'Ship small', kind: 'lesson' }, OPTIONS)

    expect(memoryWriteFn).toHaveBeenCalledWith({
      kind: 'remember',
      memory: 'lesson',
      text: 'Ship small',
    })
  })

  it('maps the loop and decision tools onto their kit commands', async () => {
    const memoryWriteFn = writer()
    const tools = buildMemoryTools({ memoryWriteFn, allowEdits: true })

    await tools.open_loop.execute?.({ title: 'Send the deck', due: '2026-11-14' }, OPTIONS)
    await tools.update_loop.execute?.({ id: 'loop-1', status: 'waiting-user' }, OPTIONS)
    await tools.close_loop.execute?.({ id: 'loop-1', outcome: 'Sent' }, OPTIONS)
    await tools.record_decision.execute?.(
      { title: 'Node', description: 'Kit runtime', decision: 'Require Node' },
      OPTIONS,
    )

    expect(memoryWriteFn.mock.calls.map(([command]) => command)).toEqual([
      { kind: 'loop-open', title: 'Send the deck', due: '2026-11-14' },
      { kind: 'loop-update', id: 'loop-1', status: 'waiting-user' },
      { kind: 'loop-close', id: 'loop-1', outcome: 'Sent' },
      { kind: 'decision', title: 'Node', description: 'Kit runtime', decision: 'Require Node' },
    ])
  })

  it('refuses without "Allow edits" and never runs the kit', async () => {
    const memoryWriteFn = writer()
    const tools = buildMemoryTools({ memoryWriteFn, allowEdits: false })

    const output = await tools.remember.execute?.({ text: 'x', source: 'chat' }, OPTIONS)

    expect(output).toEqual({ ok: false, error: MEMORY_EDITS_DISABLED_ERROR })
    expect(memoryWriteFn).not.toHaveBeenCalled()
  })

  it('refuses honestly in a vault without a kit', async () => {
    const tools = buildMemoryTools({ memoryWriteFn: null, allowEdits: true })

    const output = await tools.close_loop.execute?.({ id: 'loop-1', outcome: 'done' }, OPTIONS)

    expect(output).toEqual({ ok: false, error: MEMORY_KIT_ABSENT_ERROR })
  })

  it('passes the kit refusal through unchanged', async () => {
    const refusal: BrainResult = { ok: false, error: 'error: refusing a secret' }
    const tools = buildMemoryTools({ memoryWriteFn: writer(refusal), allowEdits: true })

    const output = await tools.remember.execute?.({ text: 'sk-1', source: 'chat' }, OPTIONS)

    expect(output).toEqual(refusal)
  })
})

describe('memoryToolLabel', () => {
  it('names what each tool was asked to keep', () => {
    expect(memoryToolLabel('remember', { text: 'a fact' })).toBe('a fact')
    expect(memoryToolLabel('open_loop', { title: 'a loop' })).toBe('a loop')
    expect(memoryToolLabel('close_loop', { id: 'loop-2' })).toBe('loop-2')
    expect(memoryToolLabel('record_decision', { title: 7 })).toBe('')
  })
})
