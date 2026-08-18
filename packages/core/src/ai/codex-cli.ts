import { z } from 'zod'
import type { ChatStreamEvent } from './chat/stream-chat'
import { call } from '../ipc/invoke'
import { agentCliPrompt, streamAgentCliTurn, type AgentCliChunk } from './agent-cli'
import type { StreamCliChatOptions } from './claude-cli'

/**
 * The Codex CLI provider ("subscription" AI): chat runs through the locally
 * installed `codex` binary in headless mode (`codex exec --json`), billing
 * the user's ChatGPT subscription instead of a BYOK API key. This module
 * owns the binary's protocol — arguments, the permission profile, and
 * parsing its JSONL events; the transport lives in `./agent-cli`.
 *
 * Grounding: Codex reads notes with its own sandboxed shell. The run gets a
 * custom permission profile whose base is *restricted* — nothing on disk is
 * readable except the entries it grants: the graph subtree is readable, and
 * every `private: true` note (plus `.reflect/` and `.git/`, whose index and
 * history embed private content) carries an explicit deny entry, enforced
 * fail-closed by Codex's sandbox. Network stays restricted; writes are never
 * granted. That keeps the hard privacy block intact even though the CLI
 * reads files itself.
 *
 * Unlike Claude Code, `codex exec --json` emits whole agent messages, not
 * token deltas — the reply appears in one piece when it completes.
 */

/** The model id meaning "whatever the CLI is configured to use". */
export const CODEX_CLI_DEFAULT_MODEL = 'default'

/** The custom permission profile name the run selects. */
const PROFILE = 'reflect_chat'

/**
 * Check that the `codex` binary is installed and runnable; resolves with
 * its version string. This provider's whole "key validation".
 */
export async function checkCodexCli(): Promise<string> {
  return await call('agent_cli_check', { binary: 'codex' }, z.string())
}

/** Build the headless run's instruction preamble (Codex has no system flag). */
export function codexCliSystemPrompt(options: {
  today: string
  graphName: string
  customSystemPrompt: string
}): string {
  const custom = options.customSystemPrompt.trim()
  return [
    `You are Reflect’s assistant, answering inside the user’s personal note graph “${options.graphName}” — the working directory, a folder of markdown files.`,
    `Today’s date is ${options.today}. Daily notes are daily/YYYY-MM-DD.md; other notes live under notes/ (file names are slugs of note titles); templates/ holds note templates and assets/ holds attachments.`,
    '',
    'Grounding rules:',
    '- When a question could be answered by the user’s notes, look them up before answering: list and read the markdown files (read-only — never modify anything).',
    '- Some notes are private and reading them is denied by the sandbox. If a read is denied, tell the user the note is private — never speculate about its contents.',
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

/** Escape a string for use inside a TOML basic (double-quoted) string. */
function tomlString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', String.raw`\"`)}"`
}

/**
 * The run's filesystem permissions as an inline TOML table: the graph
 * subtree readable, everything else on disk unreadable (the profile's base
 * is restricted), and explicit deny entries for private notes, the index
 * database, and git history. Deny entries win over the read grant and are
 * enforced fail-closed by the sandbox.
 */
export function codexCliFilesystemToml(graphRoot: string, privateNotePaths: string[]): string {
  const root = graphRoot.replace(/[\\/]+$/, '')
  const entries = [
    `${tomlString(`${root}/**`)} = "read"`,
    `${tomlString(`${root}/.reflect`)} = "deny"`,
    `${tomlString(`${root}/.git`)} = "deny"`,
    ...privateNotePaths.map((path) => `${tomlString(`${root}/${path}`)} = "deny"`),
  ]
  return `{ ${entries.join(', ')} }`
}

/** The complete argument list for one headless chat run. */
export function codexCliArgs(options: {
  model: string
  graphRoot: string
  privateNotePaths: string[]
}): string[] {
  return [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--ephemeral',
    '--cd',
    options.graphRoot,
    '-c',
    `default_permissions="${PROFILE}"`,
    '-c',
    `permissions.${PROFILE}.filesystem=${codexCliFilesystemToml(
      options.graphRoot,
      options.privateNotePaths,
    )}`,
    ...(options.model === CODEX_CLI_DEFAULT_MODEL ? [] : ['--model', options.model]),
    // Read the prompt from stdin (arbitrary length, no arg-size limits).
    '-',
  ]
}

/**
 * Parse one `codex exec --json` JSONL line. Agent messages arrive whole on
 * `item.completed`; `turn.completed` ends the run, and `turn.failed` /
 * `error` carry the failure. Everything else (reasoning, command items,
 * to-do lists) is activity, not answer text, and is dropped.
 */
export function parseCodexCliLine(line: string): AgentCliChunk | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  const event = z
    .object({
      type: z.string(),
      item: z.object({ type: z.string(), text: z.string().optional() }).optional(),
      error: z.object({ message: z.string() }).optional(),
      message: z.string().optional(),
    })
    .safeParse(parsed)
  if (!event.success) {
    return null
  }
  const data = event.data
  if (
    data.type === 'item.completed' &&
    data.item?.type === 'agent_message' &&
    data.item.text !== undefined
  ) {
    return { type: 'text-block', text: data.item.text }
  }
  if (data.type === 'turn.completed') {
    return { type: 'result', isError: false, message: null }
  }
  if (data.type === 'turn.failed') {
    return { type: 'result', isError: true, message: data.error?.message ?? null }
  }
  if (data.type === 'error') {
    return { type: 'result', isError: true, message: data.message ?? null }
  }
  return null
}

/** Run one chat turn through the Codex CLI (see `./agent-cli`). */
export function streamCodexCliChat(options: StreamCliChatOptions): AsyncGenerator<ChatStreamEvent> {
  const preamble = codexCliSystemPrompt({
    today: options.today,
    graphName: options.graphName,
    customSystemPrompt: options.customSystemPrompt,
  })
  return streamAgentCliTurn({
    binary: 'codex',
    args: codexCliArgs({
      model: options.model,
      graphRoot: options.graphRoot,
      privateNotePaths: options.privateNotePaths,
    }),
    prompt: `<instructions>\n${preamble}\n</instructions>\n\n${agentCliPrompt(options.messages)}`,
    cwd: options.graphRoot,
    parseLine: parseCodexCliLine,
    startFailureMessage: 'Could not start the Codex CLI.',
    signal: options.signal,
  })
}
