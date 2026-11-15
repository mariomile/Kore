import { z } from 'zod'
import { call } from '../ipc/invoke'

const agentSkillInstallStateSchema = z.enum(['missing', 'current', 'stale', 'conflict'])

/**
 * Where an installed skill file stands relative to what the app would write
 * today: `missing` (no file), `current` (byte-identical), `stale` (ours, but
 * rendered from older inputs — safe to rewrite), or `conflict` (a file the
 * app doesn't manage; never overwritten or deleted).
 */
export type AgentSkillInstallState = z.infer<typeof agentSkillInstallStateSchema>

const agentSkillStatusSchema = z.object({
  /** The skill's directory name (`kore-graph-<slug>` for the graph's own, `kore-*` for the shared ones). */
  skillName: z.string(),
  /** Absolute path of the target `SKILL.md` under `~/.agents/skills/`. */
  skillPath: z.string(),
  installState: agentSkillInstallStateSchema,
})

/** One bundled skill's install status. */
export type AgentSkillStatus = z.infer<typeof agentSkillStatusSchema>

const agentSkillsStatusSchema = z.object({
  /** The skills directory (`~/.agents/skills`). */
  skillsRoot: z.string(),
  /** Absolute path of the bundled `kore` CLI the graph skill references. */
  cliPath: z.string(),
  /** The graph's own skill first, then the shared format skills. */
  skills: z.array(agentSkillStatusSchema),
})

/** Install status of every bundled agent skill (Settings → Agents). */
export type AgentSkillsStatus = z.infer<typeof agentSkillsStatusSchema>

/** The bundled skills' install status for the open graph. Read-only. */
export async function agentSkillStatus(): Promise<AgentSkillsStatus> {
  return await call('skill_status', {}, agentSkillsStatusSchema)
}

/**
 * Write (or refresh) every bundled skill under `~/.agents/skills/`.
 * Generation-pinned like every mutating command; a `conflict` file is left
 * alone and reported, the others still install.
 */
export async function agentSkillInstall(generation: number): Promise<AgentSkillsStatus> {
  return await call('skill_install', { generation }, agentSkillsStatusSchema)
}

/** Remove every managed skill file. `conflict` files are left in place. */
export async function agentSkillUninstall(generation: number): Promise<AgentSkillsStatus> {
  return await call('skill_uninstall', { generation }, agentSkillsStatusSchema)
}

/** What a user pastes into an MCP client to give it the open vault. */
export interface McpClientSetup {
  /** `mcpServers` JSON for Claude Desktop, Cursor and other config-file clients. */
  readonly configJson: string
  /** One-line `claude mcp add` command for Claude Code. */
  readonly claudeCodeCommand: string
}

/** Inputs for {@link mcpClientSetup}. */
export interface McpClientSetupOptions {
  /** Absolute path of the bundled `kore` CLI. */
  readonly cliPath: string
  /** Expose only the reading tools. */
  readonly readOnly: boolean
}

function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", String.raw`'\''`)}'`
}

/**
 * How an MCP client launches `kore mcp`: the bundled CLI with no vault path,
 * so the server serves the vault the app opened last and the pasted config
 * survives moving or renaming the vault (docs/cli.md, Graph resolution).
 * Optionally `--read-only` (no write tools).
 */
export function mcpClientSetup(options: McpClientSetupOptions): McpClientSetup {
  const args = ['mcp', ...(options.readOnly ? ['--read-only'] : [])]
  const configJson = JSON.stringify(
    { mcpServers: { kore: { command: options.cliPath, args } } },
    null,
    2,
  )
  const claudeCodeCommand = ['claude', 'mcp', 'add', 'kore', '--', options.cliPath, ...args]
    .map(shellQuote)
    .join(' ')
  return { configJson, claudeCodeCommand }
}

const mcpClientServerSchema = z.object({
  /** The client's display name (`Claude Desktop`, `Claude Code`, `Cursor`, `Windsurf`). */
  client: z.string(),
  /** The server's key in the client's config. */
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  /** Only `KORE_GRAPH`, when set: other variables never leave Rust. */
  env: z.record(z.string(), z.string()),
})

/** One `kore` MCP server another app on this machine is configured to launch. */
export type McpClientServer = z.infer<typeof mcpClientServerSchema>

/** The `kore` MCP servers configured in the known clients' own config files. Read-only. */
export async function mcpClientServers(): Promise<McpClientServer[]> {
  return await call('mcp_client_servers', {}, z.array(mcpClientServerSchema))
}

function isKoreCli(command: string): boolean {
  return /(?:^|[/\\])kore(?:\.exe)?$/.test(command)
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/[/\\]+$/, '') : path
}

/**
 * The vault folder a configured server is tied to: `--graph <path>`,
 * `--graph=<path>` or `KORE_GRAPH` on a `kore mcp` entry. `null` for a server
 * that is not Kore's, and for one that follows the vault open in Kore.
 */
export function pinnedVaultOf(server: McpClientServer): string | null {
  if (!isKoreCli(server.command) || !server.args.includes('mcp')) {
    return null
  }
  const flag = server.args.indexOf('--graph')
  const inline = server.args.find((arg) => arg.startsWith('--graph='))
  const pinned =
    flag !== -1 && flag + 1 < server.args.length
      ? server.args[flag + 1]
      : (inline?.slice('--graph='.length) ?? server.env.KORE_GRAPH)
  return pinned === undefined || pinned === '' ? null : withoutTrailingSlash(pinned)
}

/**
 * Clients whose Kore server is tied to one folder, in config order without
 * repeats; with `root`, only those tied to that folder. Such a client keeps
 * using that exact path when the vault moves, so the app asks the user to
 * paste the current config (which follows the vault) instead.
 */
export function clientsWithPinnedVault(
  servers: readonly McpClientServer[],
  root?: string,
): string[] {
  const wanted = root === undefined ? null : withoutTrailingSlash(root)
  const clients = servers
    .filter((server) => {
      const pinned = pinnedVaultOf(server)
      return pinned !== null && (wanted === null || pinned === wanted)
    })
    .map((server) => server.client)
  return [...new Set(clients)]
}
