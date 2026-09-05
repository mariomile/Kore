import { afterEach, describe, expect, it } from 'vitest'
import { decideScriptTick, runRoutineScriptTick, type ScriptTickOutcome } from './routine-script'

import { setBridge } from '../ipc/bridge'

afterEach(() => setBridge(null))

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

it('stops a cancellation that arrives during preparation before dispatching the script', async () => {
  const controller = new AbortController()
  const commands: string[] = []
  setBridge({
    invoke: async (command) => {
      commands.push(command)
      if (command === 'routine_script_prepare') controller.abort()
      return command === 'routine_script_run' ? outcome({}) : null
    },
    listen: async () => () => {},
  })
  await expect(runRoutineScriptTick('echo hello', 7, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  })
  expect(commands).toEqual(['routine_script_prepare', 'routine_script_stop', 'routine_script_run'])
})
