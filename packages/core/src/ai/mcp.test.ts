import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer, ResolvedMcpServer } from './mcp'

const getSecret = vi.hoisted(() => vi.fn<(name: string) => Promise<string | null>>())
vi.mock('../secrets/keychain', () => ({ getSecret }))

const {
  claudeMcpConfigJson,
  codexMcpConfigArgs,
  mcpSecretName,
  mcpServersSchema,
  mcpSpawnEnv,
  resolveMcpServers,
} = await import('./mcp')
const { claudeCliArgs, claudeCliSettingsJson } = await import('./claude-cli')
const { codexCliArgs } = await import('./codex-cli')

const GITHUB: McpServer = {
  id: 'id-1',
  name: 'github',
  transport: { kind: 'stdio', command: 'npx', args: ['-y', 'server-github'] },
  envKeys: ['GITHUB_TOKEN'],
  enabled: true,
}

beforeEach(() => {
  getSecret.mockReset()
})

describe('mcpServersSchema', () => {
  it('drops malformed entries and slug-unsafe names without dropping the list', () => {
    const parsed = mcpServersSchema.parse([
      GITHUB,
      { id: 'x', name: 'Bad Name!', transport: { kind: 'http', url: 'https://a' } },
      { id: 'y', name: 'linear', transport: { kind: 'http', url: 'https://linear.app/mcp' } },
    ])
    expect(parsed.map((server) => server.name)).toEqual(['github', 'linear'])
    expect(mcpServersSchema.parse('nope')).toEqual([])
  })
})

describe('resolveMcpServers', () => {
  it('resolves enabled servers with keychain env values', async () => {
    getSecret.mockResolvedValue('tok-123')
    const resolved = await resolveMcpServers([GITHUB, { ...GITHUB, id: 'off', enabled: false }])
    expect(resolved).toEqual([
      { name: 'github', transport: GITHUB.transport, env: { GITHUB_TOKEN: 'tok-123' } },
    ])
    expect(getSecret).toHaveBeenCalledWith(mcpSecretName('id-1', 'GITHUB_TOKEN'))
  })

  it('degrades a missing secret to an empty value, never a dropped server', async () => {
    getSecret.mockResolvedValue(null)
    const resolved = await resolveMcpServers([GITHUB])
    expect(resolved[0]?.env).toEqual({ GITHUB_TOKEN: '' })
  })
})

describe('config builders', () => {
  const resolved: ResolvedMcpServer[] = [
    { name: 'github', transport: GITHUB.transport, env: { GITHUB_TOKEN: String.raw`t"x\y` } },
    { name: 'web', transport: { kind: 'http', url: 'https://example.com/mcp' }, env: {} },
  ]

  it('builds the Claude inline JSON document with no secrets in it', () => {
    const config = JSON.parse(claudeMcpConfigJson(resolved)) as {
      mcpServers: Record<string, unknown>
    }
    expect(config.mcpServers['github']).toEqual({ command: 'npx', args: ['-y', 'server-github'] })
    expect(config.mcpServers['web']).toEqual({ type: 'http', url: 'https://example.com/mcp' })
    expect(claudeMcpConfigJson(resolved)).not.toContain('GITHUB_TOKEN')
  })

  it('builds the Codex -c overrides with TOML escaping and no secrets', () => {
    const args = codexMcpConfigArgs(resolved)
    expect(args).toContain('mcp_servers.github.command="npx"')
    expect(args).toContain('mcp_servers.github.args=["-y", "server-github"]')
    expect(args).toContain('mcp_servers.web.url="https://example.com/mcp"')
    expect(args.join(' ')).not.toContain('GITHUB_TOKEN')
  })

  it('merges secrets into the spawn environment instead', () => {
    expect(mcpSpawnEnv(resolved)).toEqual({ GITHUB_TOKEN: String.raw`t"x\y` })
    expect(mcpSpawnEnv([])).toEqual({})
  })

  it('rides the provider arg builders, with the servers pre-allowed on Claude', () => {
    const claude = claudeCliArgs({
      model: 'default',
      systemPrompt: 'sp',
      settingsJson: '{}',
      allowEdits: true,
      mcpServers: resolved,
    })
    const configIndex = claude.indexOf('--mcp-config')
    expect(configIndex).toBeGreaterThan(-1)
    expect(claude[configIndex + 1]).toContain('"github"')
    expect(claude).toContain('--strict-mcp-config')

    const settings = JSON.parse(claudeCliSettingsJson('/g', [], true, ['github', 'web'])) as {
      permissions: { allow?: string[] }
    }
    expect(settings.permissions.allow).toEqual(['mcp__github', 'mcp__web'])

    const codex = codexCliArgs({
      model: 'default',
      graphRoot: '/g',
      privateNotePaths: [],
      allowEdits: true,
      mcpServers: resolved,
    })
    expect(codex.join(' ')).toContain('mcp_servers.github.command')

    // No servers → no MCP config, but isolation stays on for both CLIs.
    const bare = claudeCliArgs({ model: 'default', systemPrompt: 'sp', settingsJson: '{}' })
    expect(bare).not.toContain('--mcp-config')
    expect(bare).toContain('--strict-mcp-config')
    expect(codex).toContain('--ignore-user-config')
    expect(
      JSON.parse(claudeCliSettingsJson('/g', [], false)) as { permissions: { allow?: string[] } },
    ).not.toHaveProperty('permissions.allow')
  })
})
