import type { ModelMessage } from 'ai'
import type { ChatSteering, ChatStreamEvent } from './chat/stream-chat'
import { answerHostTool, type HostToolRunner } from './chat/host-tools'
import { agentCliInput, type AgentCliChannel } from './agent-cli-input'
import type { AgentCliChunk } from './agent-cli'
import { codexAppServerHandshakePrompt, parseCodexCliLine } from './codex-app-server'
import { codexHandshakeModel, streamCodexAppServerTurn, type CodexServerRequest } from './codex-cli'
import { codexMcpConfigArgs, type ResolvedMcpServer } from './mcp'

/**
 * Chat on the user's ChatGPT subscription with Kore's own tools.
 *
 * Codex runs the agent loop through `codex app-server`, signed in with the
 * user's own ChatGPT account, but its shell and file access are switched
 * off: every vault read and write goes through the chat engine's tool
 * catalog (`./chat/host-tools`), declared as the thread's `dynamicTools`
 * and answered when the app-server asks (`item/tool/call`). So the privacy
 * gate, the proposal cards and the transcript are the API-key engine's own.
 * `dynamicTools` is part of the app-server's experimental API.
 */

/** The custom permission profile: nothing on disk beyond what exec needs. */
const PROFILE = 'kore_tools'

/** The channels Codex reads natively (images only). */
const CODEX_CHANNELS: ReadonlySet<AgentCliChannel> = new Set(['image'])

/** The argument list for a Kore-tools run: no shell, no vault access. */
export function codexKoreArgs(mcpServers: readonly ResolvedMcpServer[]): string[] {
  return [
    'app-server',
    // See `codexCliArgs`: the user's ~/.codex and other agents' plugins stay
    // out of the run (the bridge isolates CODEX_HOME).
    '--disable',
    'plugins',
    // No shell at all: the vault is reached only through Kore's tools.
    '--disable',
    'shell_tool',
    '--disable',
    'unified_exec',
    '-c',
    'approval_policy="never"',
    '-c',
    `default_permissions="${PROFILE}"`,
    // Defense in depth: even a tool that slipped through reads no files.
    '-c',
    `permissions.${PROFILE}.filesystem={ ":minimal" = "read" }`,
    ...codexMcpConfigArgs([...mcpServers]),
  ]
}

/** The `item/tool/call` params the app answers. */
function toolCallRequest(request: CodexServerRequest): {
  toolCallId: string
  name: string
  input: unknown
} | null {
  const params = request.params
  if (request.method !== 'item/tool/call' || params === null) {
    return null
  }
  const callId = params.callId
  const tool = params.tool
  if (typeof callId !== 'string' || typeof tool !== 'string') {
    return null
  }
  return { toolCallId: callId, name: tool, input: params.arguments ?? {} }
}

export interface StreamCodexKoreChatOptions {
  /** Catalog model id — `default` keeps the CLI's own setting. */
  model: string
  /** The chat system prompt (`chatTurnSetup`), Codex's base instructions. */
  instructions: string
  /** Full model-facing history including the new user message. */
  messages: ModelMessage[]
  /** Kore's chat tools, executed by the app for Codex's loop. */
  tools: HostToolRunner
  /** The user's MCP servers for this turn ([] = none). */
  mcpServers: readonly ResolvedMcpServer[]
  /** Aborts the run mid-stream (the UI's stop button). */
  signal?: AbortSignal | undefined
  /** Mid-turn steering through `turn/steer`. */
  steering?: ChatSteering | undefined
}

/** Run one chat turn on Codex with Kore's tools (see the module doc). */
export function streamCodexKoreChat(
  options: StreamCodexKoreChatOptions,
): AsyncGenerator<ChatStreamEvent> {
  const input = agentCliInput(options.messages, CODEX_CHANNELS)
  const parseState = { sawAgentMessageDelta: false }
  // Tool events produced while answering a request, handed out with the
  // next parsed line.
  const pending: AgentCliChunk[] = []
  const steering = options.steering
  return streamCodexAppServerTurn({
    args: codexKoreArgs(options.mcpServers),
    handshake: codexAppServerHandshakePrompt({
      model: codexHandshakeModel(options.model),
      threadParams: {
        baseInstructions: options.instructions,
        dynamicTools: options.tools.specs.map((spec) => ({
          type: 'function',
          name: spec.name,
          description: spec.description,
          inputSchema: spec.parameters,
        })),
      },
    }),
    // No file tools, so the run needs no place in the vault.
    cwd: null,
    mcpServers: options.mcpServers,
    userPrompt: input.text,
    attachments: input.attachments,
    parseLine: (line) => {
      const chunks = pending.splice(0)
      const chunk = parseCodexCliLine(line, parseState)
      return chunk === null ? chunks : [...chunks, chunk]
    },
    onServerRequest: async (request) => {
      const call = toolCallRequest(request)
      if (call === null) {
        return null
      }
      const answer = await answerHostTool(options.tools, call, options.signal)
      pending.push(...answer.events.map((event): AgentCliChunk => ({ type: 'event', event })))
      return {
        result: {
          contentItems: [{ type: 'inputText', text: answer.text }],
          success: !answer.isError,
        },
      }
    },
    signal: options.signal,
    steering:
      steering !== undefined
        ? {
            onSteerReady: (inject) => {
              steering.onSteerReady(async (text) => {
                await inject(text)
                pending.push({ type: 'event', event: { type: 'steer', text } })
              })
            },
          }
        : undefined,
  })
}
