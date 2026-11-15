import { describe, expect, it } from 'vitest'
import { clientsWithPinnedVault, mcpClientSetup } from './agent-skill'

describe('mcpClientSetup', () => {
  it('names no vault path, so the config follows the vault, and quotes the CLI for the shell', () => {
    const setup = mcpClientSetup({
      cliPath: "/Applications/Mario's Kore.app/Contents/MacOS/kore",
      readOnly: true,
    })
    expect(JSON.parse(setup.configJson)).toEqual({
      mcpServers: {
        kore: {
          command: "/Applications/Mario's Kore.app/Contents/MacOS/kore",
          args: ['mcp', '--read-only'],
        },
      },
    })
    expect(setup.claudeCodeCommand).toBe(
      String.raw`claude mcp add kore -- '/Applications/Mario'\''s Kore.app/Contents/MacOS/kore' mcp --read-only`,
    )
  })
})

describe('clientsWithPinnedVault', () => {
  const kore = '/Applications/Kore.app/Contents/MacOS/kore'
  const server = (client: string, args: string[], env: Record<string, string> = {}) => ({
    client,
    name: 'kore',
    command: kore,
    args,
    env,
  })

  it('finds Kore servers tied to a folder by flag or env, and ignores followers and other servers', () => {
    const servers = [
      server('Claude Desktop', ['--graph', '/Vaults/Brain/', 'mcp']),
      server('Claude Code', ['mcp'], { KORE_GRAPH: '/Vaults/Brain' }),
      server('Claude Code', ['--graph=/Vaults/Test', 'mcp', '--read-only']),
      server('Cursor', ['mcp']),
      {
        client: 'Windsurf',
        name: 'files',
        command: 'npx',
        args: ['--graph', '/Vaults/Brain'],
        env: {},
      },
    ]
    expect(clientsWithPinnedVault(servers, '/Vaults/Brain')).toEqual([
      'Claude Desktop',
      'Claude Code',
    ])
    expect(clientsWithPinnedVault(servers)).toEqual(['Claude Desktop', 'Claude Code'])
    expect(clientsWithPinnedVault(servers, '/Vaults/Other')).toEqual([])
  })
})
