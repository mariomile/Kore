import { z } from 'zod'
import { getSecret } from '../secrets/keychain'

/**
 * MCP servers for the agent CLI providers — external tools the in-app
 * agents can use, configured entirely inside the app. The settings document
 * stores each server's *shape* (name, transport, which env variables it
 * needs); the env **values** — API tokens, credentials — live only in the
 * OS keychain and are resolved at run start, so nothing secret ever sits in
 * settings, markdown, or Git.
 *
 * Servers ride only edit-mode runs: read-only chat stays a zero-egress
 * surface (nothing but the model sees note content), while an agent the
 * user has explicitly allowed to act gets its tools. Both CLIs receive the
 * configuration per run on the command line — Claude Code as one inline
 * `--mcp-config` JSON document (with `--strict-mcp-config`, so the user's
 * global MCP configuration never bleeds into a vault run), Codex as
 * `-c mcp_servers.*` overrides — and spawn the servers themselves.
 */

/** How a server is reached: a spawned stdio process, or a remote HTTP URL. */
export const mcpTransportSchema = z.union([
  z.object({
    kind: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()).catch([]),
  }),
  z.object({ kind: z.literal('http'), url: z.string().min(1) }),
])
export type McpTransport = z.infer<typeof mcpTransportSchema>

/** Tool-prefix-safe server name (`mcp__<name>__<tool>` on the Claude side). */
const MCP_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/

export const mcpServerSchema = z.object({
  id: z.string().min(1),
  /** The server's name — also its tool prefix, so it must stay slug-safe. */
  name: z.string().regex(MCP_NAME_RE),
  transport: mcpTransportSchema,
  /**
   * Env variable names the server needs (e.g. `GITHUB_TOKEN`). The values
   * are stored in the OS keychain under {@link mcpSecretName} and injected
   * into the server's environment at run start.
   */
  envKeys: z.array(z.string()).catch([]),
  enabled: z.boolean().catch(true),
})
export type McpServer = z.infer<typeof mcpServerSchema>

/** The settings-document collection; malformed entries drop, not the list. */
export const mcpServersSchema = z
  .array(z.unknown())
  .catch([])
  .transform((entries) =>
    entries.flatMap((entry) => {
      const parsed = mcpServerSchema.safeParse(entry)
      return parsed.success ? [parsed.data] : []
    }),
  )

/** Keychain entry name for one server's env variable value. */
export function mcpSecretName(serverId: string, key: string): string {
  return `mcp:${serverId}:${key}`
}

/** A server with its secrets resolved — ready to hand to a CLI run. */
export interface ResolvedMcpServer {
  name: string
  transport: McpTransport
  env: Record<string, string>
}

/**
 * Resolve the enabled servers' env values from the keychain. A missing
 * secret resolves to the empty string — the server then fails its own
 * authentication loudly instead of the run silently dropping the tool.
 */
export async function resolveMcpServers(servers: McpServer[]): Promise<ResolvedMcpServer[]> {
  const resolved: ResolvedMcpServer[] = []
  for (const server of servers) {
    if (!server.enabled) {
      continue
    }
    const env: Record<string, string> = {}
    for (const key of server.envKeys) {
      env[key] = (await getSecret(mcpSecretName(server.id, key)).catch(() => null)) ?? ''
    }
    resolved.push({ name: server.name, transport: server.transport, env })
  }
  return resolved
}

/**
 * The Claude Code side: one inline `--mcp-config` JSON document
 * (`{"mcpServers": {...}}`), stdio servers as command/args/env, HTTP ones
 * as `{type: "http", url}`.
 */
export function claudeMcpConfigJson(servers: ResolvedMcpServer[]): string {
  const entries: Record<string, unknown> = {}
  for (const server of servers) {
    entries[server.name] =
      server.transport.kind === 'stdio'
        ? { command: server.transport.command, args: server.transport.args, env: server.env }
        : { type: 'http', url: server.transport.url }
  }
  return JSON.stringify({ mcpServers: entries })
}

/** Escape a string for a TOML basic (double-quoted) string. */
function tomlString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', String.raw`\"`)}"`
}

/**
 * The Codex side: `-c mcp_servers.<name>.…` config overrides, mirroring
 * what a `[mcp_servers.<name>]` block in its config.toml would say.
 */
export function codexMcpConfigArgs(servers: ResolvedMcpServer[]): string[] {
  return servers.flatMap((server) => {
    if (server.transport.kind === 'http') {
      return ['-c', `mcp_servers.${server.name}.url=${tomlString(server.transport.url)}`]
    }
    const args = server.transport.args.map((arg) => tomlString(arg)).join(', ')
    const env = Object.entries(server.env)
      .map(([key, value]) => `${tomlString(key)} = ${tomlString(value)}`)
      .join(', ')
    return [
      '-c',
      `mcp_servers.${server.name}.command=${tomlString(server.transport.command)}`,
      '-c',
      `mcp_servers.${server.name}.args=[${args}]`,
      ...(env === '' ? [] : ['-c', `mcp_servers.${server.name}.env={ ${env} }`]),
    ]
  })
}
