import { z } from 'zod'
import { call } from '../ipc/invoke'
import { getSecret, setSecret } from '../secrets/keychain'

/**
 * Remote access (Settings → Agents): the vault reachable by cloud agents —
 * Claude on the web and iPhone, Grok, any MCP client with a URL and a token.
 *
 * Rust owns two capabilities (`remote_mcp.rs`): run `kore mcp --http` as a
 * child of the app, and run the Tailscale CLI with a timeout. Everything
 * else is decided here: the port, the token and where it lives, how
 * Tailscale's answers are read, and the order things start in.
 */

/** The loopback port the server listens on; Funnel publishes it on 443. */
export const REMOTE_ACCESS_PORT = 8765

/** Keychain entry holding the server's secret (the `KORE_MCP_TOKEN`). */
export const REMOTE_ACCESS_TOKEN_SECRET = 'kore-mcp-token'

/** Keychain entry holding the named agents' keys (the `KORE_MCP_AGENTS`). */
export const REMOTE_ACCESS_AGENTS_SECRET = 'kore-mcp-agents'

/**
 * What a named agent may do with the tools that write (Plan 33, A2): hide
 * them, keep each call as a proposal for you to accept in Activity, or run
 * them. `kore mcp` reads the same three words.
 */
export const REMOTE_AGENT_ACCESS = ['read', 'propose', 'write'] as const
export type RemoteAgentAccess = (typeof REMOTE_AGENT_ACCESS)[number]

/** An agent as the keychain holds it: `access`, or the older `write` flag. */
const remoteAgentSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    key: z.string().min(24),
    access: z.enum(REMOTE_AGENT_ACCESS).optional(),
    write: z.boolean().optional(),
  })
  .transform(({ id, name, key, access, write }) => ({
    id,
    name,
    key,
    access: access ?? (write === true ? 'write' : 'read'),
  }))

/**
 * One named agent with its own key: its writes are signed with `name`,
 * `access` says whether it may write, propose or only read (a read-only
 * server never lets it write), and removing it disconnects that agent alone.
 */
export interface RemoteAgent {
  readonly id: string
  readonly name: string
  readonly key: string
  readonly access: RemoteAgentAccess
}

const remoteMcpStatusSchema = z.object({
  running: z.boolean(),
  port: z.number().nullable(),
  graphRoot: z.string().nullable(),
  readOnly: z.boolean(),
  exitMessage: z.string().nullable(),
})

/** Whether the app's `kore mcp --http` child is running. */
export type RemoteMcpStatus = z.infer<typeof remoteMcpStatusSchema>

const tailscaleRunSchema = z.object({
  found: z.boolean(),
  code: z.number().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
})

type TailscaleRun = z.infer<typeof tailscaleRunSchema>

async function remoteMcpStart(options: {
  generation: number
  port: number
  token: string
  agents: string
  readOnly: boolean
  publicUrl: string | null
}): Promise<RemoteMcpStatus> {
  return await call('remote_mcp_start', options, remoteMcpStatusSchema)
}

/** Stop the app's server (a no-op when none runs). */
async function remoteMcpStop(): Promise<RemoteMcpStatus> {
  return await call('remote_mcp_stop', {}, remoteMcpStatusSchema)
}

/** The server's status; one that died on its own reports why. */
export async function remoteMcpStatus(): Promise<RemoteMcpStatus> {
  return await call('remote_mcp_status', {}, remoteMcpStatusSchema)
}

async function tailscale(args: readonly string[]): Promise<TailscaleRun> {
  return await call('tailscale_run', { args }, tailscaleRunSchema)
}

function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The server's token, created and stored in the keychain on first use. */
export async function remoteAccessToken(): Promise<string> {
  const existing = await getSecret(REMOTE_ACCESS_TOKEN_SECRET)
  if (existing !== null && existing.length >= 24) {
    return existing
  }
  const token = randomToken()
  await setSecret(REMOTE_ACCESS_TOKEN_SECRET, token)
  return token
}

/**
 * Replace the token. Every connected agent loses access at the next restart
 * of the server and has to be connected again.
 */
export async function rotateRemoteAccessToken(): Promise<string> {
  const token = randomToken()
  await setSecret(REMOTE_ACCESS_TOKEN_SECRET, token)
  return token
}

/** The named agents, oldest first. A missing or unreadable entry is none. */
export async function remoteAgents(): Promise<RemoteAgent[]> {
  const stored = await getSecret(REMOTE_ACCESS_AGENTS_SECRET)
  if (stored === null || stored === '') {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    return []
  }
  const agents = z.array(remoteAgentSchema).safeParse(parsed)
  return agents.success ? agents.data : []
}

async function saveRemoteAgents(agents: readonly RemoteAgent[]): Promise<void> {
  await setSecret(REMOTE_ACCESS_AGENTS_SECRET, JSON.stringify(agents))
}

/** Give a new agent its own key with `access`; it works once the server restarts. */
export async function addRemoteAgent(
  name: string,
  access: RemoteAgentAccess,
): Promise<RemoteAgent> {
  const trimmed = name.trim()
  if (trimmed === '') {
    throw new Error('Give the agent a name.')
  }
  const agents = await remoteAgents()
  if (agents.some((agent) => agent.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`An agent called “${trimmed}” already has a key.`)
  }
  const agent: RemoteAgent = {
    id: randomToken().slice(0, 16),
    name: trimmed,
    key: randomToken(),
    access,
  }
  await saveRemoteAgents([...agents, agent])
  return agent
}

/** Change what an agent may do, keeping its key; it applies at the restart. */
export async function setRemoteAgentAccess(id: string, access: RemoteAgentAccess): Promise<void> {
  const agents = await remoteAgents()
  await saveRemoteAgents(agents.map((agent) => (agent.id === id ? { ...agent, access } : agent)))
}

/** Remove an agent's key: that agent alone is disconnected at the restart. */
export async function removeRemoteAgent(id: string): Promise<void> {
  const agents = await remoteAgents()
  await saveRemoteAgents(agents.filter((agent) => agent.id !== id))
}

/**
 * The sentence a user pastes into any agent so it connects itself: the
 * server's public `setup.md` holds the steps and no secret.
 */
export function remoteAccessSetupPrompt(mcpUrl: string): string {
  const setupUrl = `${mcpUrl.replace(/\/mcp$/, '')}/setup.md`
  return `Read ${setupUrl} and connect to my Kore vault. Ask me for the key when you need it.`
}

/** What `tailscale status --json` says about this Mac. */
export type TailscaleNode =
  | { readonly kind: 'online'; readonly dnsName: string }
  | { readonly kind: 'offline'; readonly message: string }

/** Read `tailscale status --json`: connected, and under which MagicDNS name. */
export function parseTailscaleStatus(stdout: string): TailscaleNode {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return { kind: 'offline', message: 'Tailscale did not answer. Open the Tailscale app.' }
  }
  const status = z
    .object({
      BackendState: z.string().optional(),
      Self: z.object({ DNSName: z.string().optional() }).optional(),
    })
    .safeParse(parsed)
  if (!status.success || status.data.BackendState !== 'Running') {
    return { kind: 'offline', message: 'Tailscale is not connected. Open it and sign in.' }
  }
  const dnsName = (status.data.Self?.DNSName ?? '').replace(/\.$/, '')
  if (dnsName === '') {
    return { kind: 'offline', message: 'Turn on MagicDNS in the Tailscale admin console.' }
  }
  return { kind: 'online', dnsName }
}

/** What `tailscale funnel --bg <port>` did. */
export type FunnelOutcome =
  | { readonly kind: 'on' }
  | { readonly kind: 'needs-enable'; readonly enableUrl: string }
  | { readonly kind: 'error'; readonly message: string }

/**
 * Read a `tailscale funnel` run. When Funnel (or HTTPS) is off for the
 * tailnet, the CLI prints a login.tailscale.com link and waits for an admin
 * to open it; the run is cut off by its timeout and the link is the answer.
 */
export function parseFunnelRun(run: {
  code: number | null
  stdout: string
  stderr: string
}): FunnelOutcome {
  const output = `${run.stdout}\n${run.stderr}`
  const enable = /https:\/\/login\.tailscale\.com\/f\/\S+/.exec(output)
  if (enable !== null) {
    return { kind: 'needs-enable', enableUrl: enable[0] }
  }
  if (run.code === 0) {
    return { kind: 'on' }
  }
  const message = output
    .trim()
    .split('\n')
    .find((line) => line.trim() !== '')
  return { kind: 'error', message: message?.trim() ?? 'tailscale funnel failed' }
}

/** How the server is reachable from outside this Mac. */
export type RemoteTunnel =
  | { readonly kind: 'on' }
  | { readonly kind: 'no-tailscale' }
  | { readonly kind: 'offline'; readonly message: string }
  | { readonly kind: 'needs-enable'; readonly enableUrl: string }
  | { readonly kind: 'error'; readonly message: string }

/** The result of turning remote access on. */
export interface RemoteAccessState {
  readonly server: RemoteMcpStatus
  /** The URL on this Mac (`http://127.0.0.1:<port>/mcp`). */
  readonly localUrl: string
  /** The internet URL agents use, once Tailscale knows this Mac's name. */
  readonly publicUrl: string | null
  readonly tunnel: RemoteTunnel
}

/** `http://127.0.0.1:<port>/mcp` */
export function remoteAccessLocalUrl(port = REMOTE_ACCESS_PORT): string {
  return `http://127.0.0.1:${port}/mcp`
}

/**
 * Turn remote access on for the open graph: find this Mac's Tailscale name,
 * start `kore mcp --http` with the keychain token (told its public origin,
 * so OAuth metadata names the right host), then publish it with Funnel.
 * A missing or offline Tailscale still leaves the server running locally.
 */
export async function startRemoteAccess(options: {
  readonly generation: number
  readonly readOnly: boolean
  readonly port?: number
}): Promise<RemoteAccessState> {
  const port = options.port ?? REMOTE_ACCESS_PORT
  const token = await remoteAccessToken()
  const agents = await remoteAgents()
  const status = await tailscale(['status', '--json'])
  const node: TailscaleNode | null = status.found ? parseTailscaleStatus(status.stdout) : null
  const origin = node?.kind === 'online' ? `https://${node.dnsName}` : null

  const server = await remoteMcpStart({
    generation: options.generation,
    port,
    token,
    agents: JSON.stringify(agents),
    readOnly: options.readOnly,
    publicUrl: origin,
  })
  const localUrl = remoteAccessLocalUrl(port)
  if (node === null) {
    return { server, localUrl, publicUrl: null, tunnel: { kind: 'no-tailscale' } }
  }
  if (node.kind === 'offline') {
    return { server, localUrl, publicUrl: null, tunnel: node }
  }
  const tunnel = parseFunnelRun(await tailscale(['funnel', '--bg', String(port)]))
  return { server, localUrl, publicUrl: `${origin}/mcp`, tunnel }
}

/** Turn remote access off: unpublish, then stop the server. */
export async function stopRemoteAccess(port = REMOTE_ACCESS_PORT): Promise<void> {
  try {
    await tailscale(['funnel', '--bg', String(port), 'off'])
  } catch {
    // Unpublishing is best effort: with the server stopped, Funnel only
    // forwards to a closed port.
  }
  await remoteMcpStop()
}
