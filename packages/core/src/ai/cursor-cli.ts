import { z } from 'zod'
import type { ChatStreamEvent } from './chat/stream-chat'
import { call } from '../ipc/invoke'
import {
  agentCliPrompt,
  runAgentCliCommand,
  streamAgentCliTurn,
  noteCardAndMentionRules,
  noteContentSafetyRules,
  type AgentCliChunk,
} from './agent-cli'
import { agentContextPromptLines, type AgentPromptContext } from './agent-profiles'
import type { StreamCliChatOptions } from './claude-cli'

/**
 * The Cursor CLI provider ("subscription" AI): chat runs through the locally
 * installed `cursor-agent` binary in headless mode (`cursor-agent -p
 * --output-format stream-json`), billing the user's Cursor subscription.
 * This module owns the binary's protocol — arguments, the permission file,
 * and parsing its NDJSON events; the transport lives in `./agent-cli`.
 *
 * Grounding: Cursor reads notes with its own tools inside the graph
 * workspace. Its permission layer is declarative and file-based — the
 * bridge materializes `.cursor/cli.json` in the workspace before the spawn
 * (project config wins over the user's global one) with reads allowed,
 * every `private: true` note plus `.reflect/` and `.git/` denied, and
 * `Shell`/`WebFetch`/`Write`/`Delete`/`Grep`/`Mcp` denied outright. The run
 * also passes `--mode ask` (Cursor's read-only posture) and omits
 * `--force`, which headless writes additionally require — three layers
 * that each keep the vault read-only on their own.
 *
 * Deliberately read-only: this engine never joins edit mode or automations
 * until its write path is verified against the real CLI. Chat grounding,
 * private-note fencing, and the chat model selector all work.
 */

/** The model id meaning "whatever the CLI is configured to use". */
export const CURSOR_CLI_DEFAULT_MODEL = 'default'

/**
 * Check that the `cursor-agent` binary is installed and runnable; resolves
 * with its version string. This provider's whole "key validation".
 */
export async function checkCursorCli(): Promise<string> {
  return await call('agent_cli_check', { binary: 'cursor-agent' }, z.string())
}

export interface CursorAuthStatus {
  loggedIn: boolean
  /** The CLI's own status line ("Logged in as …", "Not logged in"). */
  detail: string
}

/**
 * Whether the Cursor CLI holds credentials (`cursor-agent status`). The
 * command's exit code is not a reliable signal, so the answer is read from
 * the status text the way every integration does: a "logged in" line that
 * isn't "not logged in".
 */
export async function cursorLoginStatus(): Promise<CursorAuthStatus> {
  const result = await runAgentCliCommand({ binary: 'cursor-agent', args: ['status'] })
  if (result.code === null) {
    throw new Error(result.failure ?? 'could not run the Cursor CLI')
  }
  const joined = result.lines.join('\n')
  const loggedIn = /logged in/i.test(joined) && !/not logged in/i.test(joined)
  const detail = result.lines.find((line) => /logged/i.test(line))?.trim() ?? ''
  return { loggedIn, detail }
}

/**
 * The run's declarative permissions, as the contents of the workspace's
 * `.cursor/cli.json`. Deny entries win over allows; paths are relative, so
 * they scope to the workspace (the graph root). Reads are explicitly
 * allowed so grounding works regardless of the CLI's default disposition —
 * except the denied paths, which stay unreadable fail-closed.
 */
export function cursorCliPermissionsJson(privateNotePaths: string[]): string {
  return JSON.stringify({
    permissions: {
      allow: ['Read(**)', 'Ls(**)'],
      deny: [
        'Shell(*)',
        'WebFetch(*)',
        'Write(**)',
        'Delete(**)',
        // Like Claude Code's settings: Grep output prints file content past
        // per-file rules, so it is denied wholly; listings (names only) stay.
        'Grep(**)',
        // The user's own MCP servers must never ride a vault run.
        'Mcp(:)',
        'Read(.reflect/**)',
        'Read(.git/**)',
        ...privateNotePaths.map((path) => `Read(${path})`),
      ],
    },
  })
}

/** Build the headless run's instruction preamble (Cursor has no system flag). */
export function cursorCliSystemPrompt(options: {
  today: string
  graphName: string
  customSystemPrompt: string
  agentContext?: AgentPromptContext | null | undefined
  memoryWriteApproval?: boolean | undefined
}): string {
  const custom = options.customSystemPrompt.trim()
  return [
    `You are Reflect’s assistant, answering inside the user’s personal note graph “${options.graphName}” — the working directory, a folder of markdown files.`,
    `Today’s date is ${options.today}. Daily notes are daily/YYYY-MM-DD.md; other notes live under notes/ (file names are slugs of note titles); templates/ holds note templates and assets/ holds attachments.`,
    'Tasks in notes are round checkboxes: `+ [ ]` open, `+ [x]` done; a leading ! (medium) or !! (high) marks priority, and the first [[YYYY-MM-DD]] wiki link inside an item is its due date. Square `- [ ]` checkboxes are plain checklists, not tasks.',
    ...agentContextPromptLines(options.agentContext ?? null, {
      canEdit: false,
      writeApproval: options.memoryWriteApproval === true,
    }),
    '',
    'Grounding rules:',
    '- When a question could be answered by the user’s notes, look them up before answering: list and read the markdown files (read-only — never modify anything).',
    '- Some notes are private and reading them is denied. If a read is denied, tell the user the note is private — never speculate about its contents.',
    '- Ground answers in what you read. If the notes don’t cover something, say so plainly instead of guessing.',
    '- Cite every note you draw on with a wiki link of its exact title (its H1, or the file name without extension), e.g. [[Project Atlas]]. For daily notes use the date, e.g. [[2026-06-14]].',
    ...noteCardAndMentionRules(),
    ...noteContentSafetyRules(),
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
 * The complete argument list for one headless chat run. The prompt rides as
 * the trailing positional argument — `cursor-agent -p` takes it there, and
 * the transcript budget keeps it far under argv limits.
 */
export function cursorCliArgs(options: {
  model: string
  graphRoot: string
  prompt: string
}): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    // Cursor's read-only posture; writes would additionally need --force,
    // which is never passed.
    '--mode',
    'ask',
    // Headless runs can't answer the workspace-trust prompt.
    '--trust',
    '--workspace',
    options.graphRoot,
    ...(options.model === CURSOR_CLI_DEFAULT_MODEL ? [] : ['--model', options.model]),
    options.prompt,
  ]
}

/**
 * Parse one `cursor-agent --output-format stream-json` NDJSON line.
 * Assistant messages arrive whole per turn segment; `result` ends the run
 * and carries the error flag. System/init, user echoes, thinking, and tool
 * events are activity, not answer text, and are dropped.
 */
export function parseCursorCliLine(line: string): AgentCliChunk | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  const event = z
    .object({
      type: z.string(),
      message: z
        .object({
          content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
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
  if (data.type === 'assistant' && data.message !== undefined) {
    const text = data.message.content
      .filter((block) => block.type === 'text' && block.text !== undefined)
      .map((block) => block.text)
      .join('')
    return text === '' ? null : { type: 'text-block', text }
  }
  if (data.type === 'result') {
    return {
      type: 'result',
      isError: data.is_error === true,
      message: data.result ?? null,
    }
  }
  return null
}

/** Run one chat turn through the Cursor CLI (see `./agent-cli`). */
export function streamCursorCliChat(
  options: StreamCliChatOptions,
): AsyncGenerator<ChatStreamEvent> {
  const preamble = cursorCliSystemPrompt({
    today: options.today,
    graphName: options.graphName,
    customSystemPrompt: options.customSystemPrompt,
    agentContext: options.agentContext,
    memoryWriteApproval: options.memoryWriteApproval,
  })
  return streamAgentCliTurn({
    binary: 'cursor-agent',
    args: cursorCliArgs({
      model: options.model,
      graphRoot: options.graphRoot,
      prompt: `<instructions>\n${preamble}\n</instructions>\n\n${agentCliPrompt(options.messages)}`,
    }),
    // The prompt rides argv (see cursorCliArgs); stdin closes empty so the
    // CLI can never block waiting on it.
    prompt: '',
    cwd: options.graphRoot,
    workspaceConfig: {
      relativePath: '.cursor/cli.json',
      contents: cursorCliPermissionsJson(options.privateNotePaths),
    },
    parseLine: parseCursorCliLine,
    startFailureMessage: 'Could not start the Cursor CLI.',
    signal: options.signal,
  })
}
