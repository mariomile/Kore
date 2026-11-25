import { z } from 'zod'
import type { ModelMessage } from 'ai'
import type { ChatStreamEvent, ChatSteering } from './chat/stream-chat'
import { answerHostTool, type HostToolRunner } from './chat/host-tools'
import { agentCliInput } from './agent-cli-input'
import { streamAgentCliTurn, type AgentCliChunk } from './agent-cli'
import {
  CLAUDE_CLI_CHANNELS,
  CLAUDE_CLI_DEFAULT_MODEL,
  CLAUDE_CLI_MAX_TURNS,
  claudeStreamJsonUserLine,
  createClaudeCliLineParser,
} from './claude-cli'
import { claudeCliErrorMessage } from './claude-auth'
import { claudeMcpServerEntries, mcpSpawnEnv, type ResolvedMcpServer } from './mcp'

/**
 * Chat on the user's Claude subscription with Kore's own tools.
 *
 * Claude Code runs the agent loop (the unmodified `claude` binary, signed in
 * with the user's own account, as Anthropic's terms require), but it gets no
 * file tools at all: every vault read and write goes through the chat
 * engine's tool catalog (`./chat/host-tools`), mounted as an in-process MCP
 * server over Claude Code's SDK control channel. The CLI asks the app on
 * stdout (`control_request` / `mcp_message`), the app answers on stdin. So
 * the privacy gate, the proposal cards and the transcript are the API-key
 * engine's own, whichever loop runs the turn.
 */

/** The server name, and so the tool prefix the model sees (`mcp__kore__…`). */
export const KORE_MCP_SERVER = 'kore'

const MCP_PROTOCOL_VERSION = '2025-06-18'
const KORE_TOOL_PREFIX = `mcp__${KORE_MCP_SERVER}__`

const controlRequestSchema = z.object({
  type: z.literal('control_request'),
  request_id: z.string(),
  request: z.object({
    subtype: z.string(),
    server_name: z.string().optional(),
    message: z
      .object({
        id: z.union([z.string(), z.number()]).optional(),
        method: z.string(),
        params: z
          .object({
            name: z.string().optional(),
            arguments: z.unknown().optional(),
            _meta: z.record(z.string(), z.unknown()).optional(),
          })
          .passthrough()
          .optional(),
      })
      .optional(),
  }),
})

type ControlRequest = z.infer<typeof controlRequestSchema>
type McpMessage = NonNullable<ControlRequest['request']['message']>

const assistantToolUsesSchema = z.object({
  type: z.literal('assistant'),
  message: z.object({
    content: z.array(
      z.object({ type: z.string(), id: z.string().optional(), name: z.string().optional() }),
    ),
  }),
})

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

/** The JSON-RPC reply to one MCP message, or null for a notification. */
type McpReply = Record<string, unknown> | null

/** One run's protocol state: the raw-line handler and the chunk parser. */
export interface ClaudeKoreSession {
  /** Answer the CLI's control requests (the Kore MCP server). */
  onRawLine: (line: string, sendLine: (line: string) => Promise<void>) => Promise<void>
  /** The stream-json parser, with Kore tool calls shown as chat tool events. */
  parseLine: (line: string) => AgentCliChunk[]
  /** Queue an event for the next parsed line (a delivered steer). */
  relay: (event: Extract<ChatStreamEvent, { type: 'steer' }>) => void
}

/**
 * The stateful protocol reader for one run. A Kore tool call is shown when
 * the CLI asks the app to run it (`tools/call`), so it appears as the
 * engine's own proposal card or tool chip; its `tool_use` step is dropped
 * from the generic step list. Built-in steps (subagents, user MCP tools)
 * keep the regular parser.
 */
export function createClaudeKoreSession(
  tools: HostToolRunner,
  signal?: AbortSignal,
): ClaudeKoreSession {
  const pending: AgentCliChunk[] = []
  const koreCallIds = new Set<string>()
  // No vault paths to relativize: the run has no file tools.
  const baseParse = createClaudeCliLineParser('')

  const callTool = async (message: McpMessage, id: string | number): Promise<McpReply> => {
    const toolUseId = message.params?._meta?.['claudecode/toolUseId']
    const answer = await answerHostTool(
      tools,
      {
        toolCallId: typeof toolUseId === 'string' ? toolUseId : `kore-${String(id)}`,
        name: message.params?.name ?? '',
        input: message.params?.arguments ?? {},
      },
      signal,
    )
    pending.push(...answer.events.map((event): AgentCliChunk => ({ type: 'event', event })))
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: answer.text }],
        ...(answer.isError ? { isError: true } : {}),
      },
    }
  }

  const answer = async (message: McpMessage): Promise<McpReply> => {
    const id = message.id
    if (id === undefined) {
      return null
    }
    switch (message.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: KORE_MCP_SERVER, version: '1' },
          },
        }
      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: tools.specs.map((spec) => ({
              name: spec.name,
              description: spec.description,
              inputSchema: spec.parameters,
            })),
          },
        }
      case 'tools/call':
        return await callTool(message, id)
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }
    }
  }

  return {
    onRawLine: async (line, sendLine) => {
      const control = controlRequestSchema.safeParse(parseJson(line))
      if (!control.success) {
        return
      }
      const { request_id: requestId, request } = control.data
      if (request.subtype !== 'mcp_message' || request.server_name !== KORE_MCP_SERVER) {
        // Nothing else is asked of a host that declares no hooks or
        // permission callbacks; an error reply keeps the CLI from waiting.
        await sendLine(
          JSON.stringify({
            type: 'control_response',
            response: { subtype: 'error', request_id: requestId, error: 'Not supported' },
          }),
        )
        return
      }
      const reply = request.message === undefined ? null : await answer(request.message)
      await sendLine(
        JSON.stringify({
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: requestId,
            // A notification has no reply; the control channel still wants
            // its request acknowledged with an (empty) MCP message.
            response: { mcp_response: reply ?? { jsonrpc: '2.0', result: {}, id: 0 } },
          },
        }),
      )
    },
    parseLine: (line) => {
      const chunks = pending.splice(0)
      // Only an assistant line naming a Kore tool needs the second parse.
      const toolUses = line.includes(KORE_TOOL_PREFIX)
        ? assistantToolUsesSchema.safeParse(parseJson(line))
        : null
      if (toolUses?.success === true) {
        for (const block of toolUses.data.message.content) {
          if (
            block.type === 'tool_use' &&
            block.id !== undefined &&
            block.name?.startsWith(KORE_TOOL_PREFIX)
          ) {
            koreCallIds.add(block.id)
          }
        }
      }
      for (const chunk of baseParse(line)) {
        const id =
          chunk.type === 'step-start' ? chunk.step.id : chunk.type === 'step-end' ? chunk.id : null
        if (id === null || !koreCallIds.has(id)) {
          chunks.push(chunk)
        }
      }
      return chunks
    },
    relay: (event) => {
      pending.push({ type: 'event', event })
    },
  }
}

/** The argument list for a Kore-tools run: no built-in tools, Kore's server mounted. */
export function claudeKoreArgs(options: {
  model: string
  instructions: string
  mcpServers: readonly ResolvedMcpServer[]
}): string[] {
  const userServers = options.mcpServers.filter((server) => server.name !== KORE_MCP_SERVER)
  const mcpConfig = {
    mcpServers: {
      ...claudeMcpServerEntries(userServers),
      [KORE_MCP_SERVER]: { type: 'sdk', name: KORE_MCP_SERVER },
    },
  }
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--max-turns',
    String(CLAUDE_CLI_MAX_TURNS),
    // No built-in tools: the vault is reached only through Kore's tools.
    '--tools',
    '',
    '--allowedTools',
    [KORE_MCP_SERVER, ...userServers.map((server) => server.name)]
      .map((name) => `mcp__${name}`)
      .join(','),
    // Kore's chat prompt replaces Claude Code's coding-assistant one.
    '--system-prompt',
    options.instructions,
    // Only this run's servers exist: the user's global MCP setup stays out.
    '--strict-mcp-config',
    '--mcp-config',
    JSON.stringify(mcpConfig),
    ...(options.model === CLAUDE_CLI_DEFAULT_MODEL ? [] : ['--model', options.model]),
  ]
}

export interface StreamClaudeKoreChatOptions {
  /** Catalog model id — `default` sends no model flag (the CLI's own setting). */
  model: string
  /** The chat system prompt (`chatTurnSetup`). */
  instructions: string
  /** Full model-facing history including the new user message. */
  messages: ModelMessage[]
  /** Kore's chat tools, executed by the app for Claude Code's loop. */
  tools: HostToolRunner
  /** The user's MCP servers for this turn ([] = none). */
  mcpServers: readonly ResolvedMcpServer[]
  /** Aborts the run mid-stream (the UI's stop button). */
  signal?: AbortSignal | undefined
  /** Mid-turn steering through the stream-json input channel. */
  steering?: ChatSteering | undefined
}

/** Run one chat turn on Claude Code with Kore's tools (see the module doc). */
export async function* streamClaudeKoreChat(
  options: StreamClaudeKoreChatOptions,
): AsyncGenerator<ChatStreamEvent> {
  const input = agentCliInput(options.messages, CLAUDE_CLI_CHANNELS)
  const session = createClaudeKoreSession(options.tools, options.signal)
  const steering = options.steering
  const events = streamAgentCliTurn({
    binary: 'claude',
    args: claudeKoreArgs({
      model: options.model,
      instructions: options.instructions,
      mcpServers: options.mcpServers,
    }),
    prompt: `${claudeStreamJsonUserLine(input.text, input.attachments)}\n`,
    // No file tools, so the run needs no place in the vault.
    cwd: null,
    env: mcpSpawnEnv([...options.mcpServers]),
    // Tool answers and steers ride the same held-open stdin.
    keepStdinOpen: true,
    onRawLine: session.onRawLine,
    parseLine: session.parseLine,
    startFailureMessage: 'Could not start the Claude Code CLI.',
    signal: options.signal,
    steering:
      steering !== undefined
        ? {
            encodeLine: (text) => claudeStreamJsonUserLine(text),
            onReady: (inject) => {
              steering.onSteerReady(async (text) => {
                await inject(text)
                session.relay({ type: 'steer', text })
              })
            },
            resultMode: 'same-turn',
          }
        : undefined,
  })
  for await (const event of events) {
    yield event.type === 'error'
      ? { ...event, message: claudeCliErrorMessage(event.message) }
      : event
  }
}
