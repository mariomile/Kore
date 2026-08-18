import { z } from 'zod'
import type { ModelMessage } from 'ai'
import { call } from '../ipc/invoke'
import type { ChatStreamEvent } from './chat/stream-chat'
import { agentCliPrompt, streamAgentCliTurn, type AgentCliChunk } from './agent-cli'

/**
 * The Claude Code CLI provider ("subscription" AI): chat runs through the
 * locally installed `claude` binary in headless mode, billing the user's
 * Claude subscription instead of a BYOK API key. This module owns the
 * binary's protocol — arguments, tool lockdown, privacy deny rules, and
 * parsing its stream-json lines; the transport lives in `./agent-cli`.
 *
 * Grounding works differently from the BYOK engine: instead of Reflect's
 * note tools, the CLI's own read-only tools (`Read`, `Glob`) run inside the
 * graph directory. `Grep` is deliberately excluded — its matches would print
 * file *content*, and per-file permission rules can't filter it, so allowing
 * it would leak private-note lines. `Read` is covered: every `private: true`
 * note gets an explicit deny rule (plus `.reflect/` and `.git/`, whose index
 * and history embed private content), enforced by the CLI's permission
 * layer, which keeps the hard privacy block intact.
 */

/** The only built-in CLI tools made available (see the module doc). */
export const CLAUDE_CLI_TOOLS = ['Read', 'Glob']

/** Ceiling on the CLI's internal tool round-trips per question. */
export const CLAUDE_CLI_MAX_TURNS = 25

/** The model id meaning "whatever the CLI is configured to use". */
export const CLAUDE_CLI_DEFAULT_MODEL = 'default'

/**
 * Check that the `claude` binary is installed and runnable; resolves with
 * its version string. This provider's whole "key validation".
 */
export async function checkClaudeCli(): Promise<string> {
  return await call('agent_cli_check', { binary: 'claude' }, z.string())
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

/**
 * The CLI `--settings` JSON enforcing the privacy hard block: one explicit
 * `Read` deny rule per `private: true` note, plus the index database and git
 * history (both embed private-note content) — absolute paths, matched by the
 * CLI's permission layer, not by prompt — and defensive denies for tools
 * outside the allowed set.
 */
export function claudeCliSettingsJson(graphRoot: string, privateNotePaths: string[]): string {
  const root = graphRoot.replace(/[\\/]+$/, '')
  const deny = [
    // Claude Code path rules: a leading `//` anchors at the filesystem root
    // (a single `/` would be settings-relative and silently match nothing).
    ...privateNotePaths.map((path) => `Read(/${root}/${path})`),
    `Read(/${root}/.reflect/**)`,
    `Read(/${root}/.git/**)`,
    'Grep',
    'Bash',
    'Write',
    'Edit',
    'WebSearch',
    'WebFetch',
  ]
  return JSON.stringify({ permissions: { deny } })
}

/** The complete argument list for one headless chat run. */
export function claudeCliArgs(options: {
  model: string
  systemPrompt: string
  settingsJson: string
}): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--max-turns',
    String(CLAUDE_CLI_MAX_TURNS),
    '--tools',
    CLAUDE_CLI_TOOLS.join(','),
    '--append-system-prompt',
    options.systemPrompt,
    '--settings',
    options.settingsJson,
    ...(options.model === CLAUDE_CLI_DEFAULT_MODEL ? [] : ['--model', options.model]),
  ]
}

/**
 * Parse one stream-json stdout line. Only top-level assistant text deltas
 * and the terminal result matter; every other event type (init, tool use,
 * full assistant snapshots that would duplicate the streamed deltas) is
 * dropped. A non-JSON line is noise, not an error.
 */
export function parseClaudeCliLine(line: string): AgentCliChunk | null {
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
    return { type: 'text-delta', text: data.event.delta.text }
  }
  if (data.type === 'result') {
    return { type: 'result', isError: data.is_error === true, message: data.result ?? null }
  }
  return null
}

export interface StreamCliChatOptions {
  /** Catalog model id — `default` sends no model flag (the CLI's own setting). */
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
  /** Graph-relative paths of `private: true` notes (the read deny rules). */
  privateNotePaths: string[]
  /** Aborts the run mid-stream (the UI's stop button). */
  signal?: AbortSignal | undefined
}

/** Run one chat turn through the Claude Code CLI (see `./agent-cli`). */
export function streamClaudeCliChat(
  options: StreamCliChatOptions,
): AsyncGenerator<ChatStreamEvent> {
  return streamAgentCliTurn({
    binary: 'claude',
    args: claudeCliArgs({
      model: options.model,
      systemPrompt: claudeCliSystemPrompt({
        today: options.today,
        graphName: options.graphName,
        customSystemPrompt: options.customSystemPrompt,
      }),
      settingsJson: claudeCliSettingsJson(options.graphRoot, options.privateNotePaths),
    }),
    prompt: agentCliPrompt(options.messages),
    cwd: options.graphRoot,
    parseLine: parseClaudeCliLine,
    startFailureMessage: 'Could not start the Claude Code CLI.',
    signal: options.signal,
  })
}
