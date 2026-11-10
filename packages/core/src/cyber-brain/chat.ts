import { withMemoryTools, type AgentPromptContext } from '../ai/agent-profiles'
import type { ResolvedMcpServer } from '../ai/mcp'
import { loadCyberBrainConfig } from './config'
import { runBrainCommand, type BrainCommand, type BrainResult } from './script'
import { loadMemoryMcpServer, MEMORY_CHAT_AGENT, MEMORY_MCP_SERVER_NAME } from './trust'

/**
 * Give an agent CLI chat run the kit's memory tools (Plan 35). In a vault
 * that keeps memory with cyber-brain, a run that may write (`canWrite`: edit
 * mode on an engine that takes MCP servers) gets `kore mcp --memory-only`,
 * the same tools ChatGPT or Grok reach, and its prompt says so. Any other
 * run keeps the prompt that tells the model it cannot save memory. Never
 * throws: without the bundled CLI the run just goes without the tools.
 */
export async function attachMemoryTools(options: {
  readonly context: AgentPromptContext | null
  readonly canWrite: boolean
  readonly graphRoot: string
  /** The servers the run already carries; a name clash keeps the user's. */
  readonly servers: readonly ResolvedMcpServer[]
}): Promise<{ context: AgentPromptContext | null; servers: ResolvedMcpServer[] }> {
  const servers = [...options.servers]
  const { context } = options
  if (
    context?.memoryKit == null ||
    !options.canWrite ||
    servers.some((server) => server.name === MEMORY_MCP_SERVER_NAME)
  ) {
    return { context, servers }
  }
  const server = await loadMemoryMcpServer(options.graphRoot)
  if (server === null) {
    return { context, servers }
  }
  return { context: withMemoryTools(context), servers: [...servers, server] }
}

/**
 * The API-key chat's memory writer (Plan 35): each memory tool call runs the
 * vault's own kit script through the gated `kit_script_run`, signed as the
 * Kore chat and pinned to the turn's vault generation. Null when the vault
 * has no kit (or no vault is open), so the engine leaves the tools out.
 */
export async function memoryWriteForChat(
  context: AgentPromptContext | null,
  generation: number | null,
): Promise<((command: BrainCommand) => Promise<BrainResult>) | null> {
  if (context?.memoryKit == null || generation === null) return null
  const config = await loadCyberBrainConfig().catch(() => null)
  if (config === null) return null
  return async (command) =>
    await runBrainCommand(config, command, { agent: MEMORY_CHAT_AGENT }, generation)
}
