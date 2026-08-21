import { describe, expect, it } from 'vitest'
import { decideScriptTick, type ScriptTickOutcome } from './routine-script'

function outcome(overrides: Partial<ScriptTickOutcome>): ScriptTickOutcome {
  return { code: 0, stdout: '', stderr: '', timedOut: false, ...overrides }
}

describe('decideScriptTick', () => {
  it('a quiet success is a silent skip', () => {
    expect(decideScriptTick(outcome({}))).toEqual({ kind: 'skip' })
    expect(decideScriptTick(outcome({ stdout: '  \n ' }))).toEqual({ kind: 'skip' })
  })

  it('the explicit wakeAgent:false contract also skips', () => {
    expect(decideScriptTick(outcome({ stdout: '{"wakeAgent": false}\n' }))).toEqual({
      kind: 'skip',
    })
  })

  it('output wakes the agent with the output as context', () => {
    expect(decideScriptTick(outcome({ stdout: '3 new captures since Sunday\n' }))).toEqual({
      kind: 'wake',
      context: '3 new captures since Sunday',
    })
    // JSON that does NOT opt out still wakes — only wakeAgent:false skips.
    expect(decideScriptTick(outcome({ stdout: '{"changed": 2}' }))).toEqual({
      kind: 'wake',
      context: '{"changed": 2}',
    })
  })

  it('failures and timeouts feed the retry machinery, with the stderr tail', () => {
    const failed = decideScriptTick(outcome({ code: 3, stderr: 'boom\nreal reason' }))
    expect(failed.kind).toBe('fail')
    if (failed.kind === 'fail') {
      expect(failed.message).toContain('code 3')
      expect(failed.message).toContain('real reason')
    }
    expect(decideScriptTick(outcome({ code: null, timedOut: true }))).toMatchObject({
      kind: 'fail',
    })
  })
})
