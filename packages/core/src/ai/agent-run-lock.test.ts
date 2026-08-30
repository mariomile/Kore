import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { withAgentRunLock } from './agent-run-lock'

/** A bridge whose invoke log tells the story of lease traffic. */
function installLeaseBridge(): { calls: { command: string; args: Record<string, unknown> }[] } {
  const calls: { command: string; args: Record<string, unknown> }[] = []
  let nextLease = 1
  setBridge({
    invoke: (command, args) => {
      calls.push({ command, args })
      if (command === 'agent_run_lock_acquire') {
        return Promise.resolve(nextLease++)
      }
      if (command === 'agent_run_lock_release') {
        return Promise.resolve(null)
      }
      return Promise.reject(new Error(`unexpected command ${command}`))
    },
    listen: async () => () => {},
  })
  return { calls }
}

afterEach(() => {
  setBridge(null)
})

describe('withAgentRunLock', () => {
  it('takes the native lease around the work and releases it after', async () => {
    const { calls } = installLeaseBridge()
    const order: string[] = []
    await withAgentRunLock(async () => {
      order.push('work')
      expect(calls.map((entry) => entry.command)).toEqual(['agent_run_lock_acquire'])
    })
    order.push('after')
    expect(order).toEqual(['work', 'after'])
    expect(calls.map((entry) => entry.command)).toEqual([
      'agent_run_lock_acquire',
      'agent_run_lock_release',
    ])
    expect(calls[1]?.args).toEqual({ leaseId: 1 })
  })

  it('serializes queued runs, one lease cycle each', async () => {
    const { calls } = installLeaseBridge()
    const order: string[] = []
    let releaseFirst: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const first = withAgentRunLock(async () => {
      order.push('first-start')
      await gate
      order.push('first-end')
    })
    const second = withAgentRunLock(async () => {
      order.push('second')
    })
    await Promise.resolve()
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second'])
    // The second acquire happens only after the first release: two full
    // lease cycles, never interleaved.
    expect(calls.map((entry) => entry.command)).toEqual([
      'agent_run_lock_acquire',
      'agent_run_lock_release',
      'agent_run_lock_acquire',
      'agent_run_lock_release',
    ])
  })

  it('degrades to the local lock when the host lacks the command', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('command not found'))
    setBridge({ invoke, listen: async () => () => {} })
    const work = vi.fn().mockResolvedValue('done')
    await expect(withAgentRunLock(work)).resolves.toBe('done')
    expect(work).toHaveBeenCalledOnce()
    // No lease was granted, so nothing to release.
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('runs without any bridge at all (tests, plain-browser dev)', async () => {
    setBridge(null)
    await expect(withAgentRunLock(async () => 'ok')).resolves.toBe('ok')
  })

  it('releases the lease when the work throws', async () => {
    const { calls } = installLeaseBridge()
    await expect(
      withAgentRunLock(async () => {
        throw new Error('run failed')
      }),
    ).rejects.toThrow('run failed')
    expect(calls.map((entry) => entry.command)).toEqual([
      'agent_run_lock_acquire',
      'agent_run_lock_release',
    ])
  })
})
