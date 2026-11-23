import { z } from 'zod'
import type { ModelMessage } from 'ai'
import type { ChatSteering, ChatStreamEvent } from './chat/stream-chat'
import type { HostToolRunner } from './chat/host-tools'
import { agentCliInput, type AgentCliAttachment, type AgentCliChannel } from './agent-cli-input'
import { streamAgentCliTurn, SUPPORT_FILE_ARG, type AgentCliChunk } from './agent-cli'
import { PI_EXTENSION_SOURCE } from './pi-extension'

/**
 * The pi harness provider: chat runs through the locally installed `pi`
 * binary (pi.dev) in RPC mode — JSONL commands on stdin, responses and
 * session events on stdout. pi owns the agent loop, the model providers and
 * their sign-ins (subscription or API key, whatever the user set up with
 * `pi auth login`); Kore owns everything the model can do.
 *
 * Unlike the other CLI engines, pi gets **no file access**: its built-in
 * tools, extensions, skills, context files and MCP support are switched off
 * and the only extension loaded is Kore's (`./pi-extension`), which
 * registers the chat tools and routes every call back to the app. So the
 * tool catalog, the privacy gate and the proposal cards are the API-key
 * engine's own — one implementation, two loops — and pi has no permission
 * system to configure because there is nothing left for it to permit.
 *
 * This module owns the binary's protocol: arguments, the stdin lines, and
 * parsing its records. The transport lives in `./agent-cli`.
 */

/** The model id meaning "whatever pi is configured to use". */
export const PI_CLI_DEFAULT_MODEL = 'default'

/** The file name the Kore extension is written under in app data. */
export const PI_EXTENSION_FILE = 'kore-pi-extension.js'

/** The environment variable the extension reads the tool specs from. */
export const PI_TOOLS_ENV = 'KORE_PI_TOOLS'

/** The dialog title that marks an `input` request as a Kore tool call. */
const TOOL_REQUEST_TITLE = 'kore-tool'

/** pi reads images natively; other files are named in the prompt as unreadable. */
export const PI_CLI_CHANNELS: ReadonlySet<AgentCliChannel> = new Set(['image'])

/** The complete argument list for one RPC chat run. */
export function piCliArgs(options: { model: string; systemPrompt: string }): string[] {
  return [
    '--mode',
    'rpc',
    // Stateless like the other engines: the transcript rides each prompt.
    '--no-session',
    // Nothing of the user's own pi setup may reach a vault run: no
    // discovered or built-in extensions (which also turns MCP off), no
    // file/shell tools, no skills, prompt templates, themes or AGENTS.md
    // discovery, and no project-local `.pi/` files.
    '--no-extensions',
    '--no-builtin-tools',
    '--no-skills',
    '--no-prompt-templates',
    '--no-themes',
    '--no-context-files',
    '--no-approve',
    '--extension',
    SUPPORT_FILE_ARG,
    ...(options.model === PI_CLI_DEFAULT_MODEL ? [] : ['--model', options.model]),
    '--system-prompt',
    options.systemPrompt,
  ]
}

/** One stdin line that starts the run with the user's message. */
export function piPromptLine(
  text: string,
  attachments: readonly AgentCliAttachment[] = [],
): string {
  return JSON.stringify({
    id: 'prompt',
    type: 'prompt',
    message: text,
    ...(attachments.length > 0
      ? {
          images: attachments.map((attachment) => ({
            type: 'image',
            data: attachment.base64,
            mimeType: attachment.mediaType,
          })),
        }
      : {}),
  })
}

/** One stdin line that steers the live run with another user message. */
export function piSteerLine(text: string): string {
  return JSON.stringify({ type: 'steer', message: text })
}

const messageSchema = z.object({
  role: z.string(),
  content: z.unknown().optional(),
  stopReason: z.string().optional(),
  errorMessage: z.string().optional(),
})

const recordSchema = z.object({
  type: z.string(),
  // response
  command: z.string().optional(),
  success: z.boolean().optional(),
  error: z.string().optional(),
  // session events
  message: messageSchema.optional(),
  assistantMessageEvent: z.object({ type: z.string(), delta: z.string().optional() }).optional(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  args: z.unknown().optional(),
  // extension UI requests
  id: z.string().optional(),
  method: z.string().optional(),
  title: z.string().optional(),
  placeholder: z.string().optional(),
})

type PiRecord = z.infer<typeof recordSchema>

const toolRequestSchema = z.object({
  toolCallId: z.string(),
  name: z.string(),
  input: z.unknown(),
})

/** The dialog methods that block pi until the client answers. */
const DIALOG_METHODS: ReadonlySet<string> = new Set(['select', 'confirm', 'input', 'editor'])

function parseRecord(line: string): PiRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  const record = recordSchema.safeParse(parsed)
  return record.success ? record.data : null
}

/** The text of a user message's content (a string, or text blocks). */
function userText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  const blocks = z
    .array(z.object({ type: z.string(), text: z.string().optional() }))
    .safeParse(content)
  return blocks.success
    ? blocks.data
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('')
    : ''
}

/** One run's protocol state: the raw-line handler and the chunk parser. */
export interface PiCliSession {
  /**
   * Answer what pi asks of the app — a Kore tool call is executed and
   * replied to; any other dialog is cancelled so pi never waits on a UI
   * that does not exist. Runs before {@link PiCliSession.parseLine} sees the
   * same line.
   */
  onRawLine: (line: string, sendLine: (line: string) => Promise<void>) => Promise<void>
  /** Reduce one stdout record to the chunks the chat stream needs. */
  parseLine: (line: string) => AgentCliChunk[]
}

/**
 * The stateful protocol reader for one pi run. Tool calls arrive twice: as
 * a `tool_execution_start` event (shown at once, so a slow tool is visible
 * while it runs) and as the extension's `input` dialog (executed by
 * `tools`, answered on stdin, shown as the result). Text streams as deltas;
 * `agent_settled` — pi's "nothing more will happen" — is the turn's result.
 */
export function createPiCliSession(tools: HostToolRunner, signal?: AbortSignal): PiCliSession {
  // Chunks produced while answering a raw line, handed out with its parse.
  const pending: AgentCliChunk[] = []
  let userMessages = 0
  let assistantHasText = false
  let needsBreak = false
  let lastError: string | null = null

  const answerTool = async (
    record: PiRecord,
    sendLine: (line: string) => Promise<void>,
  ): Promise<void> => {
    let request: z.infer<typeof toolRequestSchema> | null = null
    try {
      const parsed = toolRequestSchema.safeParse(JSON.parse(record.placeholder ?? ''))
      request = parsed.success ? parsed.data : null
    } catch {
      request = null
    }
    if (request === null) {
      await sendLine(
        JSON.stringify({ type: 'extension_ui_response', id: record.id, cancelled: true }),
      )
      return
    }
    const outcome = await tools.run(request, signal)
    if (outcome.ok) {
      if (outcome.result !== null) {
        pending.push({ type: 'event', event: { type: 'tool-result', result: outcome.result } })
      }
    } else {
      pending.push({
        type: 'event',
        event: { type: 'tool-error', toolCallId: request.toolCallId, message: outcome.error },
      })
    }
    await sendLine(
      JSON.stringify({
        type: 'extension_ui_response',
        id: record.id,
        value: JSON.stringify(outcome.ok ? { output: outcome.output } : { error: outcome.error }),
      }),
    )
  }

  return {
    onRawLine: async (line, sendLine) => {
      const record = parseRecord(line)
      if (record === null) {
        return
      }
      if (
        record.type === 'tool_execution_start' &&
        record.toolCallId !== undefined &&
        record.toolName !== undefined
      ) {
        const call = await tools.describe({
          toolCallId: record.toolCallId,
          name: record.toolName,
          input: record.args,
        })
        if (call !== null) {
          pending.push({ type: 'event', event: { type: 'tool-call', call } })
        }
        return
      }
      if (record.type !== 'extension_ui_request' || record.id === undefined) {
        return
      }
      if (record.method === 'input' && record.title === TOOL_REQUEST_TITLE) {
        await answerTool(record, sendLine)
      } else if (record.method !== undefined && DIALOG_METHODS.has(record.method)) {
        await sendLine(
          JSON.stringify({ type: 'extension_ui_response', id: record.id, cancelled: true }),
        )
      }
    },
    parseLine: (line) => {
      const chunks = pending.splice(0)
      const record = parseRecord(line)
      if (record === null) {
        return chunks
      }
      switch (record.type) {
        case 'message_start':
          if (record.message?.role === 'user') {
            userMessages += 1
            // The first user message is the prompt; any later one is a
            // steer pi just delivered into the run.
            if (userMessages > 1) {
              chunks.push({
                type: 'event',
                event: { type: 'steer', text: userText(record.message.content) },
              })
            }
          } else if (record.message?.role === 'assistant') {
            // A new assistant message after earlier text (a tool round, a
            // steer) starts its own paragraph.
            needsBreak = assistantHasText
          }
          break
        case 'message_update': {
          const delta = record.assistantMessageEvent
          if (delta?.type === 'text_delta' && delta.delta !== undefined && delta.delta !== '') {
            chunks.push({
              type: 'text-delta',
              text: needsBreak ? `\n\n${delta.delta}` : delta.delta,
            })
            needsBreak = false
            assistantHasText = true
          }
          break
        }
        case 'message_end':
          if (record.message?.role === 'assistant') {
            // A failed attempt may be retried by pi; only the last
            // assistant message decides how the run ended.
            lastError =
              record.message.stopReason === 'error'
                ? (record.message.errorMessage ?? 'pi reported an error.')
                : null
          }
          break
        case 'response':
          if (record.command === 'prompt' && record.success === false) {
            chunks.push({
              type: 'result',
              isError: true,
              message: record.error ?? 'pi rejected the prompt.',
            })
          }
          break
        case 'agent_settled':
          chunks.push({ type: 'result', isError: lastError !== null, message: lastError })
          break
        default:
          break
      }
      return chunks
    },
  }
}

export interface StreamPiCliChatOptions {
  /** Catalog model id — `default` sends no model flag (pi's own setting). */
  model: string
  /** The chat system prompt, replacing pi's coding-assistant one. */
  instructions: string
  /** Full model-facing history including the new user message. */
  messages: ModelMessage[]
  /** Kore's chat tools, executed by the app for pi's loop. */
  tools: HostToolRunner
  /** Aborts the run mid-stream (the UI's stop button). */
  signal?: AbortSignal | undefined
  /** Mid-turn steering through pi's `steer` command. */
  steering?: ChatSteering | undefined
}

/** Run one chat turn through the pi harness (see `./agent-cli`). */
export function streamPiCliChat(options: StreamPiCliChatOptions): AsyncGenerator<ChatStreamEvent> {
  const input = agentCliInput(options.messages, PI_CLI_CHANNELS)
  const session = createPiCliSession(options.tools, options.signal)
  const steering = options.steering
  return streamAgentCliTurn({
    binary: 'pi',
    args: piCliArgs({ model: options.model, systemPrompt: options.instructions }),
    prompt: `${piPromptLine(input.text, input.attachments)}\n`,
    // pi has no file tools, so it needs no place in the vault.
    cwd: null,
    env: { [PI_TOOLS_ENV]: JSON.stringify(options.tools.specs) },
    supportFile: { fileName: PI_EXTENSION_FILE, contents: PI_EXTENSION_SOURCE },
    // RPC is a conversation: tool answers and steers ride the same pipe.
    keepStdinOpen: true,
    onRawLine: session.onRawLine,
    parseLine: session.parseLine,
    startFailureMessage: 'Could not start pi.',
    signal: options.signal,
    steering:
      steering !== undefined
        ? {
            encodeLine: piSteerLine,
            onReady: steering.onSteerReady,
            // pi folds a steer into the live run and settles once.
            resultMode: 'same-turn',
          }
        : undefined,
  })
}
