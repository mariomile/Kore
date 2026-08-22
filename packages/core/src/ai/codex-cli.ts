import { z } from 'zod'
import type { ChatStreamEvent } from './chat/stream-chat'
import { call } from '../ipc/invoke'
import {
  agentCliPrompt,
  runAgentCliCommand,
  streamAgentCliTurn,
  noteCardAndMentionRules,
  noteContentSafetyRules,
  vaultEditRules,
} from './agent-cli'
import { agentContextPromptLines, type AgentPromptContext } from './agent-profiles'
import { codexMcpConfigArgs, mcpSpawnEnv, type ResolvedMcpServer } from './mcp'
import type { StreamCliChatOptions } from './claude-cli'
import {
  CODEX_FIRST_STEER_ID,
  codexAppServerHandshakePrompt,
  codexTurnStartLine,
  codexTurnSteerLine,
  isJsonRecord,
  parseCodexCliLine,
  threadIdFromAppServerLine,
  turnIdFromAppServerLine,
  type CodexCliParseState,
} from './codex-app-server'

export {
  codexAppServerHandshakePrompt,
  parseCodexCliLine,
  type CodexCliParseState,
} from './codex-app-server'

/**
 * The Codex CLI provider ("subscription" AI): chat runs through the locally
 * installed `codex` binary via `codex app-server` (JSON-RPC over stdio),
 * billing the user's ChatGPT subscription instead of a BYOK API key. This
 * module owns the binary's protocol — arguments, the permission profile,
 * and the live session; JSON-RPC parse/handshake live in
 * `./codex-app-server`, and the transport lives in `./agent-cli`.
 *
 * Grounding: Codex reads notes with its own sandboxed shell. The run gets a
 * custom permission profile whose base is *restricted* — nothing on disk is
 * readable except the entries it grants: the graph subtree is readable, and
 * every `private: true` note (plus `.reflect/` and `.git/`, whose index and
 * history embed private content) carries an explicit deny entry, enforced
 * fail-closed by Codex's sandbox. Network stays restricted; writes are never
 * granted in read-only chat. That keeps the hard privacy block intact even
 * though the CLI reads files itself.
 *
 * Mid-turn steering uses `turn/steer` on the in-flight turn (same-turn
 * inject, not Claude Code's extra-result next-turn). `codex exec` cannot
 * do this: its stdin is the whole prompt until EOF.
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

export interface CodexAuthStatus {
  loggedIn: boolean
  /** The CLI's own last status line ("Logged in using ChatGPT", …). */
  detail: string
}

/** Whether the Codex CLI holds ChatGPT credentials (`codex login status`). */
export async function codexLoginStatus(): Promise<CodexAuthStatus> {
  const result = await runAgentCliCommand({ binary: 'codex', args: ['login', 'status'] })
  if (result.code === null) {
    throw new Error(result.failure ?? 'could not run the Codex CLI')
  }
  return { loggedIn: result.code === 0, detail: result.lines.at(-1)?.trim() ?? '' }
}

/** The login flow prints exactly one OAuth URL, on this host. */
const CODEX_AUTH_URL_RE = /https:\/\/auth\.openai\.com\/\S+/

/**
 * Run the ChatGPT sign-in flow (`codex login`): the CLI starts a local
 * callback server and prints an OAuth URL — relayed through `onAuthUrl` for
 * the app to open in the user's browser — then blocks until the browser
 * completes the flow (or the signal cancels it). Resolves with the outcome;
 * the credentials live wherever the CLI keeps them, never in the app.
 */
export async function runCodexLogin(options: {
  onAuthUrl: (url: string) => void
  signal?: AbortSignal | undefined
}): Promise<{ success: boolean; message: string | null }> {
  let urlSeen = false
  const result = await runAgentCliCommand({
    binary: 'codex',
    args: ['login'],
    signal: options.signal,
    onLine: (line) => {
      if (urlSeen) {
        return
      }
      const url = CODEX_AUTH_URL_RE.exec(line)?.[0]
      if (url !== undefined) {
        urlSeen = true
        options.onAuthUrl(url)
      }
    },
  })
  const success = result.code === 0
  return {
    success,
    message: success ? null : (result.failure ?? result.lines.at(-1)?.trim() ?? null),
  }
}

/** Drop the CLI's stored ChatGPT credentials (`codex logout`). */
export async function codexLogout(): Promise<void> {
  await runAgentCliCommand({ binary: 'codex', args: ['logout'] })
}

/** Build the headless run's instruction preamble (Codex has no system flag). */
export function codexCliSystemPrompt(options: {
  today: string
  graphName: string
  customSystemPrompt: string
  allowEdits?: boolean | undefined
  agentContext?: AgentPromptContext | null | undefined
  memoryWriteApproval?: boolean | undefined
}): string {
  const custom = options.customSystemPrompt.trim()
  const allowEdits = options.allowEdits === true
  return [
    allowEdits
      ? `You are Reflect’s agent, working inside the user’s personal note graph “${options.graphName}” — the working directory, a folder of markdown files the running app picks up live.`
      : `You are Reflect’s assistant, answering inside the user’s personal note graph “${options.graphName}” — the working directory, a folder of markdown files.`,
    `Today’s date is ${options.today}. Daily notes are daily/YYYY-MM-DD.md; other notes live under notes/ (file names are slugs of note titles); templates/ holds note templates and assets/ holds attachments.`,
    'Tasks in notes are round checkboxes: `+ [ ]` open, `+ [x]` done; a leading ! (medium) or !! (high) marks priority, and the first [[YYYY-MM-DD]] wiki link inside an item is its due date. Square `- [ ]` checkboxes are plain checklists, not tasks.',
    ...agentContextPromptLines(options.agentContext ?? null, {
      canEdit: allowEdits,
      writeApproval: options.memoryWriteApproval === true,
    }),
    '',
    'Grounding rules:',
    allowEdits
      ? '- When a question could be answered by the user’s notes, look them up before answering: list and read the markdown files.'
      : '- When a question could be answered by the user’s notes, look them up before answering: list and read the markdown files (read-only — never modify anything).',
    '- Some notes are private and reading them is denied by the sandbox. If a read is denied, tell the user the note is private — never speculate about its contents.',
    '- Ground answers in what you read. If the notes don’t cover something, say so plainly instead of guessing.',
    '- Cite every note you draw on with a wiki link of its exact title (its H1, or the file name without extension), e.g. [[Project Atlas]]. For daily notes use the date, e.g. [[2026-06-14]].',
    ...noteCardAndMentionRules(),
    ...noteContentSafetyRules(),
    ...(allowEdits ? vaultEditRules() : []),
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
export function codexCliFilesystemToml(
  graphRoot: string,
  privateNotePaths: string[],
  allowEdits = false,
): string {
  // Forward-slash the root: a Windows graph root would otherwise produce
  // mixed-separator entries (`C:\graphs\work/notes/x.md`) the sandbox's path
  // matching may not recognize, silently weakening the deny list. Windows
  // accepts forward slashes everywhere the sandbox resolves paths.
  const root = graphRoot.replaceAll('\\', '/').replace(/\/+$/, '')
  const entries = [
    `${tomlString(`${root}/**`)} = ${allowEdits ? '"write"' : '"read"'}`,
    // Binary user data stays readable but never writable in edit mode: the
    // more specific entry overrides the subtree grant.
    ...(allowEdits
      ? [
          `${tomlString(`${root}/assets/**`)} = "read"`,
          `${tomlString(`${root}/audio-memos/**`)} = "read"`,
        ]
      : []),
    `${tomlString(`${root}/.reflect`)} = "deny"`,
    `${tomlString(`${root}/.git`)} = "deny"`,
    ...privateNotePaths.map((path) => `${tomlString(`${root}/${path}`)} = "deny"`),
  ]
  return `{ ${entries.join(', ')} }`
}

/** The complete argument list for one app-server chat run. */
export function codexCliArgs(options: {
  model: string
  graphRoot: string
  privateNotePaths: string[]
  allowEdits?: boolean | undefined
  mcpServers?: ResolvedMcpServer[] | undefined
}): string[] {
  return [
    'app-server',
    // The user's ~/.codex/config.toml (their own MCP servers, profiles,
    // approvals) must never bleed into a vault run; login credentials still
    // come from CODEX_HOME, so the ChatGPT sign-in is untouched.
    '--ignore-user-config',
    // Headless: never pause the turn on an approval JSON-RPC request.
    '-c',
    'approval_policy="never"',
    '-c',
    `default_permissions="${PROFILE}"`,
    '-c',
    `permissions.${PROFILE}.filesystem=${codexCliFilesystemToml(
      options.graphRoot,
      options.privateNotePaths,
      options.allowEdits === true,
    )}`,
    ...codexMcpConfigArgs(options.mcpServers ?? []),
  ]
}

/** Run one chat turn through the Codex CLI (see `./agent-cli`). */
export function streamCodexCliChat(options: StreamCliChatOptions): AsyncGenerator<ChatStreamEvent> {
  const preamble = codexCliSystemPrompt({
    today: options.today,
    graphName: options.graphName,
    customSystemPrompt: options.customSystemPrompt,
    allowEdits: options.allowEdits,
    agentContext: options.agentContext,
    memoryWriteApproval: options.memoryWriteApproval,
  })
  const userPrompt = `<instructions>\n${preamble}\n</instructions>\n\n${agentCliPrompt(options.messages)}`
  const parseState: CodexCliParseState = { sawAgentMessageDelta: false }
  let threadId: string | undefined
  let turnId: string | undefined
  let sentTurnStart = false
  let nextSteerId = CODEX_FIRST_STEER_ID
  let queuedSteerReady: ((text: string) => Promise<void>) | undefined
  let hostArmed = false

  const armHostIfReady = (): void => {
    if (
      hostArmed ||
      queuedSteerReady === undefined ||
      threadId === undefined ||
      turnId === undefined
    ) {
      return
    }
    hostArmed = true
    options.steering?.onSteerReady(queuedSteerReady)
  }

  const steering = options.steering
  const handshakeModel = options.model === CODEX_CLI_DEFAULT_MODEL ? undefined : options.model

  return streamAgentCliTurn({
    binary: 'codex',
    args: codexCliArgs({
      model: options.model,
      graphRoot: options.graphRoot,
      privateNotePaths: options.privateNotePaths,
      allowEdits: options.allowEdits,
      mcpServers: options.mcpServers,
    }),
    prompt: `${codexAppServerHandshakePrompt({
      graphRoot: options.graphRoot,
      model: handshakeModel,
    })}\n`,
    cwd: options.graphRoot,
    env: mcpSpawnEnv(options.mcpServers ?? []),
    keepStdinOpen: true,
    parseLine: (line) => parseCodexCliLine(line, parseState),
    startFailureMessage: 'Could not start the Codex CLI.',
    signal: options.signal,
    onRawLine: async (line, sendLine) => {
      // The handshake lives in the stream's first couple of lines; once the
      // thread and turn ids are known there is nothing left to look for, and
      // parsing every delta line a second time would shadow `parseLine`'s
      // work for the rest of the turn.
      if (sentTurnStart && turnId !== undefined) {
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        return
      }
      if (!isJsonRecord(parsed)) {
        return
      }
      const startedThread = threadIdFromAppServerLine(parsed)
      if (startedThread !== null && !sentTurnStart) {
        sentTurnStart = true
        threadId = startedThread
        await sendLine(codexTurnStartLine(threadId, userPrompt))
      }
      const startedTurn = turnIdFromAppServerLine(parsed)
      if (startedTurn !== null) {
        turnId = startedTurn
        armHostIfReady()
      }
    },
    steering:
      steering !== undefined
        ? {
            encodeLine: (text) => codexTurnSteerLine(nextSteerId++, threadId, turnId, text),
            onReady: (steer) => {
              queuedSteerReady = steer
              armHostIfReady()
            },
            resultMode: 'same-turn',
          }
        : undefined,
  })
}
