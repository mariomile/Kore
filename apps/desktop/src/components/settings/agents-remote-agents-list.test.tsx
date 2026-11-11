import { render } from 'vitest-browser-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteAgent } from '@kore/core'

const remoteAgents = vi.hoisted(() => vi.fn<() => Promise<RemoteAgent[]>>())
const addRemoteAgent = vi.hoisted(() => vi.fn())
const setRemoteAgentAccess = vi.hoisted(() => vi.fn())
const removeRemoteAgent = vi.hoisted(() => vi.fn())
vi.mock('@kore/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kore/core')>()),
  remoteAgents,
  addRemoteAgent,
  setRemoteAgentAccess,
  removeRemoteAgent,
}))
const requestRemoteAccessRestart = vi.hoisted(() => vi.fn())
vi.mock('@/lib/remote-access-store', () => ({ requestRemoteAccessRestart }))

const { AgentsRemoteAgentsList } = await import('./agents-remote-agents-list')

const GROK: RemoteAgent = { id: 'g', name: 'Grok bot', key: 'k'.repeat(32), access: 'write' }

beforeEach(() => {
  remoteAgents.mockReset().mockResolvedValue([GROK])
  addRemoteAgent.mockReset().mockResolvedValue(undefined)
  setRemoteAgentAccess.mockReset().mockResolvedValue(undefined)
  removeRemoteAgent.mockReset()
  requestRemoteAccessRestart.mockReset()
})

describe('AgentsRemoteAgentsList', () => {
  it('adds a new agent that proposes changes unless you choose otherwise', async () => {
    const view = await render(<AgentsRemoteAgentsList />)
    await expect
      .element(view.getByRole('combobox', { name: 'What the new agent may do' }))
      .toHaveTextContent('Proposes changes')
    await view.getByRole('textbox', { name: 'Agent name' }).fill('ChatGPT')
    await view.getByRole('button', { name: 'Add agent' }).click()
    await vi.waitFor(() => expect(addRemoteAgent).toHaveBeenCalledWith('ChatGPT', 'propose'))
    expect(requestRemoteAccessRestart).toHaveBeenCalled()
  })

  it('changes what an agent may do without a new key', async () => {
    const view = await render(<AgentsRemoteAgentsList />)
    const access = view.getByRole('combobox', { name: 'What Grok bot may do' })
    await expect.element(access).toHaveTextContent('Reads and writes')
    await access.click()
    await view.getByRole('option', { name: 'Proposes changes' }).click()
    await vi.waitFor(() => expect(setRemoteAgentAccess).toHaveBeenCalledWith('g', 'propose'))
    expect(addRemoteAgent).not.toHaveBeenCalled()
  })
})
