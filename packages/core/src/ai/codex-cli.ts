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
  type AgentCliChunk,
} from './agent-cli'
import { agentContextPromptLines, type AgentPromptContext } from './agent-profiles'
import { codexMcpConfigArgs, mcpSpawnEnv, type ResolvedMcpServer } from './mcp'
import type { StreamCliChatOptions } from './claude-cli'

/**
 * The Codex CLI provider ("subscription" AI): chat runs through the locally
 * installed `codex` binary via `codex app-server` (JSON-RPC over stdio),
 * billing the user's ChatGPT subscription instead of a BYOK API key. This
 * module owns the binary's protocol — arguments, the permission profile,
 * the handshake, and parsing its notifications; the transport lives in
 * `./agent-cli`.
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

/** JSON-RPC request ids for the app-server handshake (steer ids start after). */
const INITIALIZE_ID = 1
const THREAD_START_ID = 2
const TURN_START_ID = 3
const FIRST_STEER_ID = 4

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonRpcLine(payload: Record<string, unknown>): string {
  return JSON.stringify(payload)
}

function recordField(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const nested = value[key]
  return isRecord(nested) ? nested : null
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const nested = value[key]
  return typeof nested === 'string' && nested !== '' ? nested : null
}

/**
 * The initial stdin payload: `initialize`, `initialized`, and `thread/start`.
 * `turn/start` waits for the thread id on stdout — it cannot ride here.
 */
export function codexAppServerHandshakePrompt(options: {
  graphRoot: string
  model: string
}): string {
  const threadParams: Record<string, unknown> = {
    cwd: options.graphRoot,
    approvalPolicy: 'never',
    ephemeral: true,
  }
  if (options.model !== CODEX_CLI_DEFAULT_MODEL) {
    threadParams.model = options.model
  }
  return [
    jsonRpcLine({
      method: 'initialize',
      id: INITIALIZE_ID,
      params: { clientInfo: { name: 'lore', title: 'Lore' } },
    }),
    jsonRpcLine({ method: 'initialized', params: {} }),
    jsonRpcLine({
      method: 'thread/start',
      id: THREAD_START_ID,
      params: threadParams,
    }),
  ].join('\n')
}

function rpcErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }
  if (typeof value.message === 'string' && value.message !== '') {
    return value.message
  }
  const nested = value.error
  if (isRecord(nested) && typeof nested.message === 'string' && nested.message !== '') {
    return nested.message
  }
  return null
}

/** Mutable parse state so a streamed agent message is not replayed as a block. */
export interface CodexCliParseState {
  sawAgentMessageDelta: boolean
}

/**
 * Parse one Codex app-server JSONL line. Agent text arrives as
 * `item/agentMessage/delta` fragments, with `item/completed` carrying the
 * full snapshot (dropped when deltas already streamed). `turn/completed`
 * ends the run.
 */
export function parseCodexCliLine(
  line: string,
  state: CodexCliParseState = { sawAgentMessageDelta: false },
): AgentCliChunk | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(parsed)) {
    return null
  }

  const rpcError = rpcErrorMessage(parsed.error)
  if (rpcError !== null && parsed.id !== undefined) {
    return { type: 'result', isError: true, message: rpcError }
  }

  const method = typeof parsed.method === 'string' ? parsed.method : null
  const params = isRecord(parsed.params) ? parsed.params : null

  if (method === 'item/agentMessage/delta' && params !== null) {
    const delta = stringField(params, 'delta')
    if (delta === null) {
      return null
    }
    state.sawAgentMessageDelta = true
    return { type: 'text-delta', text: delta }
  }

  if (method === 'item/completed' && params !== null) {
    const item = recordField(params, 'item')
    if (item === null || stringField(item, 'type') !== 'agentMessage') {
      return null
    }
    const text = stringField(item, 'text')
    if (state.sawAgentMessageDelta) {
      state.sawAgentMessageDelta = false
      return null
    }
    if (text === null) {
      return null
    }
    return { type: 'text-block', text }
  }

  if (method === 'turn/completed' && params !== null) {
    const turn = recordField(params, 'turn')
    const status = turn === null ? null : stringField(turn, 'status')
    if (status === 'completed' || status === 'interrupted') {
      return { type: 'result', isError: false, message: null }
    }
    if (status === 'failed') {
      const error = turn === null ? null : recordField(turn, 'error')
      const message =
        error === null ? 'Codex turn failed.' : (stringField(error, 'message') ?? 'Codex turn failed.')
      return { type: 'result', isError: true, message }
    }
    return null
  }

  if (method === 'error') {
    const message = rpcErrorMessage(params) ?? rpcErrorMessage(parsed.error)
    if (message !== null) {
      return { type: 'result', isError: true, message }
    }
  }

  return null
}

function threadIdFromLine(parsed: Record<string, unknown>): string | null {
  if (parsed.id === THREAD_START_ID) {
    const result = recordField(parsed, 'result')
    const thread = result === null ? null : recordField(result, 'thread')
    return thread === null ? null : stringField(thread, 'id')
  }
  if (parsed.method === 'thread/started') {
    const params = recordField(parsed, 'params')
    const thread = params === null ? null : recordField(params, 'thread')
    return thread === null ? null : stringField(thread, 'id')
  }
  return null
}

function turnIdFromLine(parsed: Record<string, unknown>): string | null {
  if (parsed.id === TURN_START_ID) {
    const result = recordField(parsed, 'result')
    const turn = result === null ? null : recordField(result, 'turn')
    return turn === null ? null : stringField(turn, 'id')
  }
  if (parsed.method === 'turn/started') {
    const params = recordField(parsed, 'params')
    const turn = params === null ? null : recordField(params, 'turn')
    return turn === null ? null : stringField(turn, 'id')
  }
  return null
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
  let nextSteerId = FIRST_STEER_ID
  let queuedSteerReady: ((text: string) => Promise<void>) | undefined
  let hostArmed = false

  const armHostIfReady = (): void => {
    if (hostArmed || queuedSteerReady === undefined || threadId === undefined || turnId === undefined) {
      return
    }
    hostArmed = true
    options.steering?.onSteerReady(queuedSteerReady)
  }

  const steering = options.steering

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
      model: options.model,
    })}\n`,
    cwd: options.graphRoot,
    env: mcpSpawnEnv(options.mcpServers ?? []),
    keepStdinOpen: true,
    parseLine: (line) => parseCodexCliLine(line, parseState),
    startFailureMessage: 'Could not start the Codex CLI.',
    signal: options.signal,
    onRawLine: async (line, sendLine) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        return
      }
      if (!isRecord(parsed)) {
        return
      }
      const startedThread = threadIdFromLine(parsed)
      if (startedThread !== null && !sentTurnStart) {
        sentTurnStart = true
        threadId = startedThread
        await sendLine(
          jsonRpcLine({
            method: 'turn/start',
            id: TURN_START_ID,
            params: {
              threadId,
              input: [{ type: 'text', text: userPrompt }],
            },
          }),
        )
      }
      const startedTurn = turnIdFromLine(parsed)
      if (startedTurn !== null) {
        turnId = startedTurn
        armHostIfReady()
      }
    },
    steering:
      steering !== undefined
        ? {
            encodeLine: (text) =>
              jsonRpcLine({
                method: 'turn/steer',
                id: nextSteerId++,
                params: {
                  threadId,
                  expectedTurnId: turnId,
                  input: [{ type: 'text', text }],
                },
              }),
            onReady: (steer) => {
              queuedSteerReady = steer
              armHostIfReady()
            },
            resultMode: 'same-turn',
          }
        : undefined,
  })
}
