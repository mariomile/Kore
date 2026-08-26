import { describe, expect, it, vi } from 'vitest'
import { adoptGraphToIcloud } from './icloud-adopt'

const NEW_ROOT = '/icloud/Documents/Notes'

describe('adoptGraphToIcloud', () => {
  it('copies first, then reopens at the new root, with no Git disconnect when disconnected', async () => {
    const adopt = vi.fn(async () => NEW_ROOT)
    const disconnectGraph = vi.fn(async () => {})
    const openRecent = vi.fn(async () => true)

    await expect(
      adoptGraphToIcloud({
        generation: 7,
        backupConnected: false,
        adopt,
        disconnectGraph,
        openRecent,
      }),
    ).resolves.toEqual({ newRoot: NEW_ROOT, opened: true, warning: null })

    expect(adopt).toHaveBeenCalledWith(7)
    expect(disconnectGraph).not.toHaveBeenCalled()
    expect(openRecent).toHaveBeenCalledWith(NEW_ROOT)
    expect(adopt.mock.invocationCallOrder[0]).toBeLessThan(openRecent.mock.invocationCallOrder[0]!)
  })

  it('disconnects GitHub only after the copy succeeds', async () => {
    const adopt = vi.fn(async () => NEW_ROOT)
    const disconnectGraph = vi.fn(async () => {})
    const openRecent = vi.fn(async () => true)

    await adoptGraphToIcloud({
      generation: 1,
      backupConnected: true,
      adopt,
      disconnectGraph,
      openRecent,
    })

    expect(disconnectGraph).toHaveBeenCalledOnce()
    expect(adopt.mock.invocationCallOrder[0]).toBeLessThan(
      disconnectGraph.mock.invocationCallOrder[0]!,
    )
    expect(disconnectGraph.mock.invocationCallOrder[0]).toBeLessThan(
      openRecent.mock.invocationCallOrder[0]!,
    )
  })

  it('leaves the original untouched when the copy fails, including its backup', async () => {
    const disconnectGraph = vi.fn(async () => {})
    const openRecent = vi.fn(async () => true)

    await expect(
      adoptGraphToIcloud({
        generation: 1,
        backupConnected: true,
        adopt: async () => {
          throw new Error('disk full')
        },
        disconnectGraph,
        openRecent,
      }),
    ).rejects.toThrow('disk full')

    expect(disconnectGraph).not.toHaveBeenCalled()
    expect(openRecent).not.toHaveBeenCalled()
  })

  it('warns without blocking when GitHub cannot be disconnected from the recovery copy', async () => {
    const result = await adoptGraphToIcloud({
      generation: 1,
      backupConnected: true,
      adopt: async () => NEW_ROOT,
      disconnectGraph: async () => {
        throw new Error('keychain locked')
      },
      openRecent: async () => true,
    })

    expect(result.opened).toBe(true)
    expect(result.warning).toMatch(/GitHub sync could not be disconnected/)
    expect(result.warning).toMatch(/keychain locked/)
  })

  it('warns when the iCloud copy cannot be opened', async () => {
    const result = await adoptGraphToIcloud({
      generation: 1,
      backupConnected: false,
      adopt: async () => NEW_ROOT,
      disconnectGraph: async () => {},
      openRecent: async () => false,
    })

    expect(result.opened).toBe(false)
    expect(result.warning).toMatch(/could not be opened/)
  })
})
