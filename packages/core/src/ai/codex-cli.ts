import type { ChatStreamEvent } from './chat/stream-chat'
import { agentCliFailureMessage, isAgentCliRuntimeFailure } from './agent-cli-failure'
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

export interface CodexAuthStatus {
  loggedIn: boolean
  /** The CLI's own last status line ("Logged in using ChatGPT", …). */
  detail: string
}

/** Whether the Codex CLI holds ChatGPT credentials (`codex login status`). */
export async function codexLoginStatus(): Promise<CodexAuthStatus> {
  const result = await runAgentCliCommand({ binary: 'codex', args: ['login', 'status'] })
  if (result.code === null || isAgentCliRuntimeFailure(result)) {
    throw new Error(agentCliFailureMessage(result) ?? 'could not run the Codex CLI')
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
    message: success ? null : agentCliFailureMessage(result),
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
  /** Names of MCP servers riding this run; the prompt must name them. */
  mcpServerNames?: string[] | undefined
}): string {
  const custom = options.customSystemPrompt.trim()
  const allowEdits = options.allowEdits === true
  const mcpServerNames = options.mcpServerNames ?? []
  return [
    allowEdits
      ? `You are Kore’s agent, working inside the user’s personal note graph “${options.graphName}” — the working directory, a folder of markdown files the running app picks up live.`
      : `You are Kore’s assistant, answering inside the user’s personal note graph “${options.graphName}” — the working directory, a folder of markdown files.`,
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
    ...(mcpServerNames.length > 0
      ? [
          `- The user turned on their configured external MCP tools for this conversation (servers: ${mcpServerNames.join(', ')}). Use them only when the user’s request needs them; the safety rules below still apply to everything you send them.`,
        ]
      : []),
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
 * Escape glob metacharacters so a literal path can sit inside a glob
 * entry. A note titled `idea [draft].md` must not turn its deny entry into
 * a character class that matches a different file — that would silently
 * leave the private note readable.
 */
function globLiteral(value: string): string {
  return value.replaceAll(/[[\]*?]/gu, (char) => (char === ']' ? '[]]' : `[${char}]`))
}

/**
 * The run's filesystem permissions as an inline TOML table: the graph
 * subtree readable, everything else on disk unreadable (the profile's base
 * is restricted; `:minimal` grants only the system paths needed to exec the
 * sandboxed shell), and explicit deny entries for private notes, the index
 * database, and git history. Deny entries win over the read grant and are
 * enforced fail-closed by the sandbox.
 *
 * Every deny target is emitted twice — as an exact path and as a glob —
 * because Codex 0.149's unified exec honors glob denies but ignores
 * exact-path read denies (openai/codex#40555), while its compiled seatbelt
 * profile honors both. The redundancy keeps the block fail-closed on either
 * enforcement path.
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
  const globRoot = globLiteral(root)
  const deny = (path: string, glob: string): string[] => [
    `${tomlString(path)} = "deny"`,
    `${tomlString(glob)} = "deny"`,
  ]
  const entries = [
    // Without this the profile cannot even launch the sandboxed shell —
    // Codex 0.149 no longer implies the minimal system paths (dyld, /bin)
    // in a restricted profile, and every command aborts on spawn.
    `":minimal" = "read"`,
    `${tomlString(`${globRoot}/**`)} = ${allowEdits ? '"write"' : '"read"'}`,
    // Binary user data stays readable but never writable in edit mode: the
    // more specific entry overrides the subtree grant.
    ...(allowEdits
      ? [
          `${tomlString(`${globRoot}/assets/**`)} = "read"`,
          `${tomlString(`${globRoot}/audio-memos/**`)} = "read"`,
        ]
      : []),
    ...deny(`${root}/.reflect`, `${globRoot}/.reflect/**`),
    ...deny(`${root}/.git`, `${globRoot}/.git/**`),
    ...privateNotePaths.flatMap((path) =>
      // Trailing `*` over-denies same-prefix siblings, which is the safe
      // direction: a private note must never fail open.
      deny(`${root}/${path}`, `${globRoot}/${globLiteral(path)}*`),
    ),
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
    // The user's ~/.codex (their own MCP servers, plugins, profiles,
    // approvals) must never bleed into a vault run. `app-server` lost its
    // `--ignore-user-config` flag in Codex 0.149, so isolation now comes
    // from a private app-managed CODEX_HOME the Rust bridge provisions per
    // run ({@link streamAgentCliTurn}'s `isolatedCodexHome`), with the
    // user's `auth.json` copied in so the ChatGPT sign-in still works.
    // Disabling plugins also keeps Codex from importing MCP servers and
    // hooks from other agent installs (e.g. ~/.claude), which it discovers
    // outside CODEX_HOME.
    '--disable',
    'plugins',
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
    mcpServerNames: (options.mcpServers ?? []).map((server) => server.name),
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
    isolatedCodexHome: true,
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
