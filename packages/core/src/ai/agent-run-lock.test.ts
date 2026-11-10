import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBridge } from '../ipc/bridge'
import { AGENT_RUN_WAIT_NOTICE_MS, withAgentRunLock } from './agent-run-lock'

/** A bridge whose invoke log tells the story of lease traffic. */
function installLeaseBridge(): {
  calls: { command: string; args: Record<string, unknown> }[]
} {
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

  it('refuses work when the native lease fails and leaves the queue usable', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('command not found'))
    setBridge({ invoke, listen: async () => () => {} })
    const work = vi.fn().mockResolvedValue('done')
    await expect(withAgentRunLock(work)).rejects.toThrow('command not found')
    expect(work).not.toHaveBeenCalled()
    // No lease was granted, so nothing to release.
    expect(invoke).toHaveBeenCalledTimes(1)
    installLeaseBridge()
    await expect(withAgentRunLock(work)).resolves.toBe('done')
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

describe('withAgentRunLock cancellation', () => {
  it('rejects a queued run as soon as its signal aborts, and the queue keeps moving', async () => {
    setBridge(null)
    let releaseFirst: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const first = withAgentRunLock(() => gate)
    const controller = new AbortController()
    const queuedWork = vi.fn().mockResolvedValue('never')
    const queued = withAgentRunLock(queuedWork, { signal: controller.signal })
    const third = withAgentRunLock(async () => 'third')
    controller.abort()
    await expect(queued).rejects.toThrow()
    expect(queuedWork).not.toHaveBeenCalled()
    releaseFirst()
    await first
    await expect(third).resolves.toBe('third')
  })

  it('hands back a native lease granted after the run was aborted', async () => {
    const calls: string[] = []
    let grant: (lease: number) => void = () => {}
    setBridge({
      invoke: (command) => {
        calls.push(command)
        if (command === 'agent_run_lock_acquire') {
          return new Promise((resolve) => {
            grant = resolve
          })
        }
        return Promise.resolve(null)
      },
      listen: async () => () => {},
    })
    const controller = new AbortController()
    const work = vi.fn().mockResolvedValue('never')
    const run = withAgentRunLock(work, { signal: controller.signal })
    await vi.waitFor(() => expect(calls).toEqual(['agent_run_lock_acquire']))
    controller.abort()
    await expect(run).rejects.toThrow()
    // The next local run waits until the late lease went back.
    let nextStarted = false
    const next = withAgentRunLock(async () => {
      nextStarted = true
    })
    await Promise.resolve()
    expect(nextStarted).toBe(false)
    grant(7)
    await vi.waitFor(() =>
      expect(calls).toEqual([
        'agent_run_lock_acquire',
        'agent_run_lock_release',
        'agent_run_lock_acquire',
      ]),
    )
    grant(8)
    await next
    expect(work).not.toHaveBeenCalled()
    expect(nextStarted).toBe(true)
  })

  it('reports a long wait once, and clears it when the lock is granted', async () => {
    vi.useFakeTimers()
    try {
      setBridge(null)
      let releaseFirst: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      const first = withAgentRunLock(() => gate)
      const events: string[] = []
      const second = withAgentRunLock(
        async () => {
          events.push('work')
        },
        {
          onWaiting: () => {
            events.push('waiting')
            return () => {
              events.push('done waiting')
            }
          },
        },
      )
      await vi.advanceTimersByTimeAsync(AGENT_RUN_WAIT_NOTICE_MS + 1)
      expect(events).toEqual(['waiting'])
      releaseFirst()
      await first
      await second
      expect(events).toEqual(['waiting', 'done waiting', 'work'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not report a wait when the lock is free', async () => {
    setBridge(null)
    const onWaiting = vi.fn(() => () => {})
    await withAgentRunLock(async () => 'ok', { onWaiting })
    expect(onWaiting).not.toHaveBeenCalled()
  })
})
