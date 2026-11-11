import { afterEach, describe, expect, it } from 'vitest'
import { setBridge } from '../ipc/bridge'
import type { AgentPromptContext } from '../ai/agent-profiles'
import { attachMemoryTools } from './chat'
import { MEMORY_MCP_SERVER_NAME } from './trust'

function bridgeWithCli(cliPath: string | null): void {
  setBridge({
    invoke: async (command: string) => {
      if (command !== 'skill_status' || cliPath === null) throw new Error(`no ${command}`)
      return { skillsRoot: '/home/.agents/skills', cliPath, skills: [] }
    },
    listen: async () => () => {},
  })
}

const base: AgentPromptContext = {
  vaultContract: null,
  profile: null,
  soul: null,
  userMemory: null,
  agentMemory: null,
  sharedFacts: null,
  sharedLog: null,
  skills: [],
  memoryPath: 'agents/assistant/memory.md',
}
const kit: AgentPromptContext = {
  ...base,
  memoryKit: {
    contractPath: 'AGENTS.md',
    skills: { dir: 'System/skills', kind: 'folder' },
    tools: false,
  },
}

afterEach(() => {
  setBridge(null)
})

describe('attachMemoryTools', () => {
  it('gives a writing run in a kit vault the memory-only kore mcp', async () => {
    bridgeWithCli('/Applications/Kore.app/Contents/MacOS/kore')
    const result = await attachMemoryTools({
      context: kit,
      canWrite: true,
      graphRoot: '/vault',
      servers: [],
    })
    expect(result.context?.memoryKit?.tools).toBe(true)
    expect(result.servers).toEqual([
      {
        name: MEMORY_MCP_SERVER_NAME,
        transport: {
          kind: 'stdio',
          command: '/Applications/Kore.app/Contents/MacOS/kore',
          args: ['--graph', '/vault', 'mcp', '--memory-only', '--agent', 'Kore chat'],
        },
        env: {},
      },
    ])
  })

  it('leaves read-only runs, plain vaults and a missing CLI alone', async () => {
    bridgeWithCli('/kore')
    const readOnly = await attachMemoryTools({
      context: kit,
      canWrite: false,
      graphRoot: '/v',
      servers: [],
    })
    expect(readOnly.servers).toEqual([])
    expect(readOnly.context?.memoryKit?.tools).toBe(false)
    const plain = await attachMemoryTools({
      context: base,
      canWrite: true,
      graphRoot: '/v',
      servers: [],
    })
    expect(plain.servers).toEqual([])
    bridgeWithCli(null)
    const noCli = await attachMemoryTools({
      context: kit,
      canWrite: true,
      graphRoot: '/v',
      servers: [],
    })
    expect(noCli.servers).toEqual([])
    expect(noCli.context?.memoryKit?.tools).toBe(false)
  })
})
