import { withMemoryTools, type AgentPromptContext } from '../ai/agent-profiles'
import type { ResolvedMcpServer } from '../ai/mcp'
import { loadMemoryMcpServer, MEMORY_MCP_SERVER_NAME } from './trust'

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
