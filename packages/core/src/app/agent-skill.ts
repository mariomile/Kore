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
  /** The skill's directory name (`reflect-<slug>` for the graph's own, `kore-*` for the shared ones). */
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
  /** Absolute path of the bundled `reflect` CLI the graph skill references. */
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

/** What a user pastes into an MCP client to give it this graph. */
export interface McpClientSetup {
  /** `mcpServers` JSON for Claude Desktop, Cursor and other config-file clients. */
  readonly configJson: string
  /** One-line `claude mcp add` command for Claude Code. */
  readonly claudeCodeCommand: string
}

/** Inputs for {@link mcpClientSetup}. */
export interface McpClientSetupOptions {
  /** Absolute path of the bundled `reflect` CLI. */
  readonly cliPath: string
  /** Absolute root of the graph the server serves. */
  readonly graphRoot: string
  /** Expose only the reading tools. */
  readonly readOnly: boolean
}

function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", String.raw`'\''`)}'`
}

/**
 * How an MCP client launches `reflect mcp` against one graph: the bundled CLI
 * pinned to the graph root, optionally `--read-only` (no write tools).
 */
export function mcpClientSetup(options: McpClientSetupOptions): McpClientSetup {
  const args = ['--graph', options.graphRoot, 'mcp', ...(options.readOnly ? ['--read-only'] : [])]
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
