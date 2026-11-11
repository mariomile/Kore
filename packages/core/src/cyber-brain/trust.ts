import { z } from 'zod'
import { agentSkillStatus } from '../app/agent-skill'
import { call } from '../ipc/invoke'
import type { ResolvedMcpServer } from '../ai/mcp'

/**
 * Whether the vault's kit script may run (Plan 35). The script is code that
 * arrives with the vault, and a synced vault can change it from another
 * machine, so Kore runs it only once the user allowed its exact content.
 * The native side hashes the whole scripts folder and keeps the allowed
 * digest beside the index (`reflect-kit-script`); the same answer gates the
 * app, `kore brain` and `kore mcp`.
 */

const kitScriptStatusSchema = z
  .object({
    version: z.string(),
    /** The entry script, graph-relative. */
    script: z.string(),
    /** `trusted`: allowed as it is; `new`: never allowed here; `changed`: edited since. */
    trust: z.enum(['trusted', 'new', 'changed']),
    /** The digest of the scripts on disk now. */
    digest: z.string(),
  })
  .nullable()

/** The kit's script and whether it may run; null when the vault has no kit. */
export type KitScriptStatus = z.infer<typeof kitScriptStatusSchema>

/** Where the open graph's kit script stands. */
export async function kitScriptStatus(): Promise<KitScriptStatus> {
  return await call('kit_script_status', {}, kitScriptStatusSchema)
}

/**
 * Allow the kit script whose digest the user was shown. Refused when the
 * scripts changed in between, so what runs is always what was approved.
 */
export async function allowKitScript(digest: string, generation: number): Promise<KitScriptStatus> {
  return await call('kit_script_trust', { digest, generation }, kitScriptStatusSchema)
}

/** The MCP server name Kore's own memory tools ride under in a chat run. */
export const MEMORY_MCP_SERVER_NAME = 'kore-memory'

/** How the run record names Kore's chat. */
export const MEMORY_CHAT_AGENT = 'Kore chat'

/**
 * The memory tools for an agent CLI chat run: the bundled `kore mcp`,
 * pinned to the graph, offering only `vault_guide` and the kit's memory
 * tools, and signing as Kore's chat. The same tools ChatGPT or Grok get
 * from `kore mcp`, so memory behaves the same whoever writes it.
 */
export function memoryMcpServer(cliPath: string, graphRoot: string): ResolvedMcpServer {
  return {
    name: MEMORY_MCP_SERVER_NAME,
    transport: {
      kind: 'stdio',
      command: cliPath,
      args: ['--graph', graphRoot, 'mcp', '--memory-only', '--agent', MEMORY_CHAT_AGENT],
    },
    env: {},
  }
}

/** {@link memoryMcpServer} with the bundled CLI's path; null when it can't be found. */
export async function loadMemoryMcpServer(graphRoot: string): Promise<ResolvedMcpServer | null> {
  try {
    const { cliPath } = await agentSkillStatus()
    return cliPath === '' ? null : memoryMcpServer(cliPath, graphRoot)
  } catch {
    return null
  }
}
