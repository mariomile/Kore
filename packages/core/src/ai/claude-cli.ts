import { z } from 'zod'
import type { ModelMessage } from 'ai'
import { getBridge } from '../ipc/bridge'
import { call } from '../ipc/invoke'
import type { ChatStreamEvent } from './chat/stream-chat'

/**
 * The Claude Code CLI provider ("subscription" AI): chat runs through the
 * locally installed `claude` binary in headless mode, billing the user's
 * Claude subscription instead of a BYOK API key. The Rust shell only spawns
 * the process and relays its stream-json stdout lines; this module owns the
 * protocol — prompt construction, tool lockdown, privacy deny rules, and
 * parsing the stream into the chat engine's {@link ChatStreamEvent}s.
 *
 * Grounding works differently from the BYOK engine: instead of Reflect's
 * note tools, the CLI's own read-only tools (`Read`, `Glob`) run inside the
 * graph directory. `Grep` is deliberately excluded — its matches would print
 * file *content*, and per-file permission rules can't filter it, so allowing
 * it would leak private-note lines. `Read` is covered: every `private: true`
 * note gets an explicit deny rule, enforced by the CLI's permission layer,
 * which keeps the hard privacy block intact.
 */

/** The only built-in CLI tools made available (see the module doc). */
export const CLAUDE_CLI_TOOLS = ['Read', 'Glob']

/** Ceiling on the CLI's internal tool round-trips per question. */
export const CLAUDE_CLI_MAX_TURNS = 25

/** The model id meaning "whatever the CLI is configured to use". */
export const CLAUDE_CLI_DEFAULT_MODEL = 'default'

/** Rough transcript budget: the CLI re-reads notes itself, so history-only. */
const MAX_TRANSCRIPT_CHARS = 60_000

/**
 * Check that the `claude` binary is installed and runnable; resolves with
 * its version string. This provider's whole "key validation".
 */
export async function checkClaudeCli(): Promise<string> {
  return await call('claude_cli_check', {}, z.string())
}

/** Build the headless run's system prompt (appended to the CLI's own). */
export function claudeCliSystemPrompt(options: {
  today: string
  graphName: string
  customSystemPrompt: string
}): string {
  const custom = options.customSystemPrompt.trim()
  return [
    `You are Reflect’s assistant, answering inside the user’s personal note graph “${options.graphName}” — the current directory, a folder of markdown files.`,
    `Today’s date is ${options.today}. Daily notes are daily/YYYY-MM-DD.md; other notes live under notes/ (file names are slugs of note titles); templates/ holds note templates and assets/ holds attachments.`,
    '',
    'Grounding rules:',
    '- When a question could be answered by the user’s notes, look them up before answering: use Glob to discover files (e.g. "daily/2026-06-*.md", "notes/*.md") and Read to read them. Only Read and Glob are available — never attempt any other tool.',
    '- Some notes are private and reading them is denied by policy. If a Read is denied, tell the user the note is private — never speculate about its contents.',
    '- Ground answers in what you read. If the notes don’t cover something, say so plainly instead of guessing.',
    '- Cite every note you draw on with a wiki link of its exact title (its H1, or the file name without extension), e.g. [[Project Atlas]]. For daily notes use the date, e.g. [[2026-06-14]].',
    '',
    'Style: answer in concise markdown. Prefer short paragraphs and lists over headings. Do not narrate your file reads — just answer.',
    ...(custom === ''
      ? []
      : [
          '',
          'User-configured instructions (follow unless they conflict with the rules above):',
          custom,
        ]),
  ].join('\n')
}

/** The readable text of one model message (attachments noted, not embedded). */
function messageText(message: ModelMessage): string {
  if (typeof message.content === 'string') {
    return message.content
  }
  const parts: string[] = []
  let attachments = 0
  for (const part of message.content) {
    if (part.type === 'text') {
      parts.push(part.text)
    } else if (part.type === 'file' || part.type === 'image') {
      attachments += 1
    }
  }
  if (attachments > 0) {
    parts.push(`[${attachments} ${attachments === 1 ? 'attachment' : 'attachments'} not shown]`)
  }
  return parts.join('\n').trim()
}

/**
 * Flatten the model-facing history into one headless prompt. The CLI has no
 * conversation state across invocations, so prior turns ride along as a
 * transcript, oldest dropped first when the budget is exceeded.
 */
export function claudeCliPrompt(messages: ModelMessage[]): string {
  const turns = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role, text: messageText(message) }))
    .filter((turn) => turn.text !== '')
  const current = turns.pop()
  if (current === undefined) {
    return ''
  }
  const history: string[] = []
  let budget = MAX_TRANSCRIPT_CHARS - current.text.length
  for (const turn of [...turns].reverse()) {
    const block = `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`
    if (block.length > budget) {
      break
    }
    budget -= block.length
    history.unshift(block)
  }
  if (history.length === 0) {
    return current.text
  }
  return [
    'Previous conversation (for context):',
    '',
    ...history,
    '',
    'Current question:',
    current.text,
  ].join('\n')
}

/**
 * The CLI `--settings` JSON enforcing the privacy hard block: one explicit
 * `Read` deny rule per `private: true` note (absolute paths — deny rules are
 * matched by the CLI's permission layer, not by prompt), plus defensive
 * denies for tools outside the allowed set.
 */
export function claudeCliSettingsJson(graphRoot: string, privateNotePaths: string[]): string {
  const root = graphRoot.replace(/[\\/]+$/, '')
  const deny = [
    // Claude Code path rules: a leading `//` anchors at the filesystem root
    // (a single `/` would be settings-relative and silently match nothing).
    ...privateNotePaths.map((path) => `Read(/${root}/${path})`),
    'Grep',
    'Bash',
    'Write',
    'Edit',
    'WebSearch',
    'WebFetch',
  ]
  return JSON.stringify({ permissions: { deny } })
}

/** One parsed stdout line, reduced to what the chat stream needs. */
export type ClaudeCliChunk =
  | { type: 'text'; text: string }
  | { type: 'result'; isError: boolean; message: string | null }

/**
 * Parse one stream-json stdout line. Only top-level assistant text deltas
 * and the terminal result matter; every other event type (init, tool use,
 * full assistant snapshots that would duplicate the streamed deltas) is
 * dropped. A non-JSON line is noise, not an error.
 */
export function parseClaudeCliLine(line: string): ClaudeCliChunk | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  const event = z
    .object({
      type: z.string(),
      parent_tool_use_id: z.string().nullable().optional(),
      event: z
        .object({
          type: z.string(),
          delta: z.object({ type: z.string(), text: z.string().optional() }).optional(),
        })
        .optional(),
      is_error: z.boolean().optional(),
      result: z.string().optional(),
    })
    .safeParse(parsed)
  if (!event.success) {
    return null
  }
  const data = event.data
  if (
    data.type === 'stream_event' &&
    (data.parent_tool_use_id ?? null) === null &&
    data.event?.type === 'content_block_delta' &&
    data.event.delta?.type === 'text_delta' &&
    data.event.delta.text !== undefined
  ) {
    return { type: 'text', text: data.event.delta.text }
  }
  if (data.type === 'result') {
    return { type: 'result', isError: data.is_error === true, message: data.result ?? null }
  }
  return null
}

const cliEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('line'), requestId: z.string(), line: z.string() }),
  z.object({ kind: z.literal('done'), requestId: z.string(), code: z.number().nullable() }),
  z.object({ kind: z.literal('failed'), requestId: z.string(), message: z.string() }),
])

const CLI_EVENT = 'claude-cli:event'

export interface StreamClaudeCliChatOptions {
  /** Catalog model id — `default` omits `--model` (the CLI's own setting). */
  model: string
  /** Full model-facing history including the new user message. */
  messages: ModelMessage[]
  /** Local ISO date for the system prompt. */
  today: string
  /** User-authored instructions appended to the built-in system prompt. */
  customSystemPrompt: string
  /** Absolute root of the open graph — the CLI's working directory. */
  graphRoot: string
  /** Display name of the graph, for the system prompt. */
  graphName: string
  /** Graph-relative paths of `private: true` notes (the Read deny rules). */
  privateNotePaths: string[]
  /** Aborts the run mid-stream (the UI's stop button). */
  signal?: AbortSignal | undefined
}

/**
 * Run one chat turn through the Claude Code CLI, yielding the same
 * normalized {@link ChatStreamEvent}s as the BYOK engine so the transcript
 * renders identically. The CLI's internal tool activity is not surfaced as
 * chips (its Read/Glob calls are its own affair, like thinking); only the
 * answer text streams.
 */
export async function* streamClaudeCliChat(
  options: StreamClaudeCliChatOptions,
): AsyncGenerator<ChatStreamEvent> {
  const requestId = crypto.randomUUID()
  const queue: z.infer<typeof cliEventSchema>[] = []
  let wake: (() => void) | null = null
  const push = (payload: unknown): void => {
    const event = cliEventSchema.safeParse(payload)
    if (!event.success || event.data.requestId !== requestId) {
      return
    }
    queue.push(event.data)
    wake?.()
    wake = null
  }
  const unlisten = await getBridge().listen(CLI_EVENT, push)

  const onAbort = (): void => {
    void getBridge()
      .invoke('claude_cli_stop', { requestId })
      .catch(() => {})
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })

  let text = ''
  const responseMessages = (): ModelMessage[] =>
    text === '' ? [] : [{ role: 'assistant', content: [{ type: 'text', text }] }]

  try {
    await getBridge().invoke('claude_cli_run', {
      requestId,
      prompt: claudeCliPrompt(options.messages),
      systemPrompt: claudeCliSystemPrompt({
        today: options.today,
        graphName: options.graphName,
        customSystemPrompt: options.customSystemPrompt,
      }),
      model: options.model === CLAUDE_CLI_DEFAULT_MODEL ? null : options.model,
      tools: CLAUDE_CLI_TOOLS,
      settingsJson: claudeCliSettingsJson(options.graphRoot, options.privateNotePaths),
      cwd: options.graphRoot,
      maxTurns: CLAUDE_CLI_MAX_TURNS,
    })
  } catch (cause) {
    unlisten()
    options.signal?.removeEventListener('abort', onAbort)
    yield {
      type: 'error',
      message:
        cause instanceof Error && cause.message !== ''
          ? cause.message
          : 'Could not start the Claude Code CLI.',
      messages: [],
    }
    return
  }

  let failure: string | null = null
  let resultError: string | null = null
  let completed = false
  try {
    while (true) {
      const event = queue.shift()
      if (event === undefined) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
        continue
      }
      if (event.kind === 'line') {
        const chunk = parseClaudeCliLine(event.line)
        if (chunk === null) {
          continue
        }
        if (chunk.type === 'text') {
          text += chunk.text
          yield { type: 'text-delta', text: chunk.text }
        } else if (chunk.isError) {
          resultError = chunk.message ?? 'The Claude Code CLI reported an error.'
        }
      } else if (event.kind === 'failed') {
        failure = event.message
      } else {
        // done — decide the terminal event.
        if (options.signal?.aborted) {
          yield { type: 'aborted', messages: responseMessages() }
        } else if (resultError !== null || failure !== null || (event.code ?? 1) !== 0) {
          yield {
            type: 'error',
            message: resultError ?? failure ?? 'The Claude Code CLI exited unexpectedly.',
            messages: responseMessages(),
          }
        } else {
          yield { type: 'complete', messages: responseMessages() }
        }
        completed = true
        return
      }
    }
  } finally {
    unlisten()
    options.signal?.removeEventListener('abort', onAbort)
    // A consumer that abandons the stream (conversation switch, unmount)
    // must not leave the CLI running headless in the background.
    if (!completed) {
      onAbort()
    }
  }
}
