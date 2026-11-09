import { z } from 'zod'
import type { ModelMessage } from 'ai'
import type { ChatStreamEvent } from './chat/stream-chat'
import { agentContextPromptLines, type AgentPromptContext } from './agent-profiles'
import { agentCliInput, type AgentCliAttachment } from './agent-cli-input'
import {
  streamAgentCliTurn,
  noteCardAndMentionRules,
  noteContentSafetyRules,
  vaultEditRules,
  type AgentCliChunk,
} from './agent-cli'
import { claudeMcpConfigJson, mcpSpawnEnv, type ResolvedMcpServer } from './mcp'
import { dailyPathPattern } from '../graph/paths'
import { describeClaudeToolCall, summarizeClaudeToolResult } from './chat/agent-steps'

/**
 * The Claude Code CLI provider ("subscription" AI): chat runs through the
 * locally installed `claude` binary in headless mode, billing the user's
 * Claude subscription instead of a BYOK API key. This module owns the
 * binary's protocol — arguments, tool lockdown, privacy deny rules, and
 * parsing its stream-json lines; the transport lives in `./agent-cli`.
 *
 * Grounding works differently from the BYOK engine: instead of Kore's
 * note tools, the CLI's own tools run inside the graph directory — `Read`
 * and `Glob` always, plus `Write` and `Edit` in chat edit mode. `Grep` is deliberately excluded — its matches would print
 * file *content*, and per-file permission rules can't filter it, so allowing
 * it would leak private-note lines. `Read` is covered: every `private: true`
 * note gets an explicit deny rule (plus `.kore/` and `.git/`, whose index
 * and history embed private content), enforced by the CLI's permission
 * layer, which keeps the hard privacy block intact.
 */

/**
 * The built-in CLI tools available in read-only chat (see the module doc).
 * `Task` is the subagent tool (emitted as `Agent` by current CLIs): a
 * subagent runs inside the same session, so the `--settings` deny rules —
 * the privacy block included — bind it exactly as they bind the main agent,
 * and it can only use the tools this list grants.
 */
export const CLAUDE_CLI_TOOLS = ['Read', 'Glob', 'Task']

/**
 * The tool set in edit mode: reading plus targeted file writes. `Bash` stays
 * out in both modes (arbitrary commands could copy a private note wholesale),
 * and `Grep` stays out because its matches print file content past the
 * per-file permission rules.
 */
export const CLAUDE_CLI_EDIT_TOOLS = ['Read', 'Glob', 'Task', 'Write', 'Edit']

/** Ceiling on the CLI's internal tool round-trips per question. */
export const CLAUDE_CLI_MAX_TURNS = 25

/** The model id meaning "whatever the CLI is configured to use". */
export const CLAUDE_CLI_DEFAULT_MODEL = 'default'

/** Build the headless run's system prompt (appended to the CLI's own). */
export function claudeCliSystemPrompt(options: {
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
      ? `You are Kore’s agent, working inside the user’s personal note graph “${options.graphName}” — the current directory, a folder of markdown files the running app picks up live.`
      : `You are Kore’s assistant, answering inside the user’s personal note graph “${options.graphName}” — the current directory, a folder of markdown files.`,
    `Today’s date is ${options.today}. Daily notes are ${dailyPathPattern()}; other notes live under notes/ (file names are slugs of note titles); templates/ holds note templates and assets/ holds attachments.`,
    'Tasks in notes are round checkboxes: `+ [ ]` open, `+ [x]` done; a leading ! (medium) or !! (high) marks priority, and the first [[YYYY-MM-DD]] wiki link inside an item is its due date. Square `- [ ]` checkboxes are plain checklists, not tasks.',
    ...agentContextPromptLines(options.agentContext ?? null, {
      canEdit: allowEdits,
      writeApproval: options.memoryWriteApproval === true,
    }),
    '',
    'Grounding rules:',
    allowEdits
      ? '- When a question could be answered by the user’s notes, look them up before answering: use Glob to discover files (e.g. "daily/2026-06-*.md", "notes/*.md") and Read to read them. Read, Glob, Write, Edit, and Task (a subagent, for independent lookups worth delegating) are available — never attempt any other tool.'
      : '- When a question could be answered by the user’s notes, look them up before answering: use Glob to discover files (e.g. "daily/2026-06-*.md", "notes/*.md") and Read to read them. Only Read, Glob, and Task (a subagent, for independent lookups worth delegating) are available — never attempt any other tool.',
    ...(mcpServerNames.length > 0
      ? [
          `- Exception: the user turned on their configured external MCP tools for this conversation (servers: ${mcpServerNames.join(', ')}). Use them only when the user’s request needs them; the safety rules below still apply to everything you send them.`,
        ]
      : []),
    '- Some notes are private and reading them is denied by policy. If a Read is denied, tell the user the note is private — never speculate about its contents.',
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

/**
 * The CLI `--settings` JSON enforcing the privacy hard block: one explicit
 * `Read` deny rule per `private: true` note, plus the index database and git
 * history (both embed private-note content) — absolute paths, matched by the
 * CLI's permission layer, not by prompt — and defensive denies for tools
 * outside the allowed set.
 */
export function claudeCliSettingsJson(
  graphRoot: string,
  privateNotePaths: string[],
  allowEdits = false,
  mcpServerNames: string[] = [],
): string {
  // Claude Code path rules: a leading `//` anchors at the filesystem root (a
  // single `/` would be settings-relative and silently match nothing). A
  // POSIX root brings its own leading slash; a Windows drive root
  // (`C:\graphs\work`) does not, and its backslashes would never match the
  // rule matcher's forward-slash paths — normalize both so the privacy block
  // cannot silently fail open off POSIX.
  const posixRoot = graphRoot.replaceAll('\\', '/').replace(/\/+$/, '')
  const root = posixRoot.startsWith('/') ? `/${posixRoot}` : `//${posixRoot}`
  // Private notes and the app's own state are fenced against every file
  // tool, not just the ones the mode enables — a defensive rule costs
  // nothing and cannot drift when the tool set changes.
  const fencedPaths = [
    ...privateNotePaths.map((path) => `${root}/${path}`),
    `${root}/.kore/**`,
    `${root}/.git/**`,
  ]
  // Binary user data stays readable but never writable: attachments and
  // audio memos are not markdown, so an agent "edit" there can only corrupt —
  // and the .md-only activity ledger would not even surface it.
  const writeFencedPaths = [`${root}/assets/**`, `${root}/audio-memos/**`]
  const deny = [
    ...fencedPaths.flatMap((path) => [`Read(${path})`, `Write(${path})`, `Edit(${path})`]),
    ...writeFencedPaths.flatMap((path) => [`Write(${path})`, `Edit(${path})`]),
    'Grep',
    'Bash',
    ...(allowEdits ? [] : ['Write', 'Edit']),
    'WebSearch',
    'WebFetch',
  ]
  // Headless runs can't prompt for tool approval, so each configured MCP
  // server's tools are pre-allowed by server name (`mcp__<name>` covers all
  // of its tools). Deny rules still win where they overlap.
  const allow = mcpServerNames.map((name) => `mcp__${name}`)
  return JSON.stringify({ permissions: { deny, ...(allow.length > 0 ? { allow } : {}) } })
}

/** The complete argument list for one headless chat run. */
export function claudeCliArgs(options: {
  model: string
  systemPrompt: string
  settingsJson: string
  allowEdits?: boolean | undefined
  mcpServers?: ResolvedMcpServer[] | undefined
  /** Steerable runs read stream-json user messages from held-open stdin. */
  streamingInput?: boolean | undefined
}): string[] {
  const mcpServers = options.mcpServers ?? []
  return [
    '-p',
    ...(options.streamingInput === true ? ['--input-format', 'stream-json'] : []),
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--max-turns',
    String(CLAUDE_CLI_MAX_TURNS),
    '--tools',
    (options.allowEdits === true ? CLAUDE_CLI_EDIT_TOOLS : CLAUDE_CLI_TOOLS).join(','),
    '--append-system-prompt',
    options.systemPrompt,
    '--settings',
    options.settingsJson,
    // The user's global MCP configuration must never bleed into a vault run:
    // only the servers the app resolved for this run exist, or none at all —
    // strict mode always, so a run with no app servers has no MCP at all.
    '--strict-mcp-config',
    ...(mcpServers.length > 0 ? ['--mcp-config', claudeMcpConfigJson(mcpServers)] : []),
    ...(options.model === CLAUDE_CLI_DEFAULT_MODEL ? [] : ['--model', options.model]),
  ]
}

const contentBlockSchema = z.object({
  type: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  tool_use_id: z.string().optional(),
  is_error: z.boolean().optional(),
  content: z.unknown().optional(),
})

const lineSchema = z.object({
  type: z.string(),
  parent_tool_use_id: z.string().nullable().optional(),
  event: z
    .object({
      type: z.string(),
      delta: z.object({ type: z.string(), text: z.string().optional() }).optional(),
    })
    .optional(),
  message: z.object({ content: z.union([z.string(), z.array(contentBlockSchema)]) }).optional(),
  tool_use_result: z.unknown().optional(),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
})

/**
 * A stateful stream-json line parser for one run. It yields top-level
 * assistant text deltas, the terminal result, and the run's tool activity:
 * every `tool_use` block in an assistant message becomes a `step-start`
 * (subagent steps carry their `parent_tool_use_id`), every `tool_result` a
 * content-free `step-end` (see `./chat/agent-steps`). Full assistant text
 * snapshots (they would duplicate the streamed deltas), thinking, and system
 * events are dropped. A non-JSON line is noise, not an error.
 *
 * `graphRoot` turns absolute file paths into graph-relative labels.
 */
export function createClaudeCliLineParser(
  graphRoot: string,
): (line: string) => AgentCliChunk | AgentCliChunk[] | null {
  // Tool names by call id, so a result can be summarized per tool.
  const tools = new Map<string, string>()
  return (line: string) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return null
    }
    const event = lineSchema.safeParse(parsed)
    if (!event.success) {
      return null
    }
    const data = event.data
    const parentId = data.parent_tool_use_id ?? null
    if (
      data.type === 'stream_event' &&
      parentId === null &&
      data.event?.type === 'content_block_delta' &&
      data.event.delta?.type === 'text_delta' &&
      data.event.delta.text !== undefined
    ) {
      return { type: 'text-delta', text: data.event.delta.text }
    }
    if (data.type === 'result') {
      return { type: 'result', isError: data.is_error === true, message: data.result ?? null }
    }
    const content = data.message?.content
    const blocks = Array.isArray(content) ? content : []
    if (data.type === 'assistant') {
      const chunks: AgentCliChunk[] = []
      for (const block of blocks) {
        if (block.type !== 'tool_use' || block.id === undefined || block.name === undefined) {
          continue
        }
        tools.set(block.id, block.name)
        chunks.push({
          type: 'step-start',
          step: describeClaudeToolCall({
            id: block.id,
            tool: block.name,
            input: block.input ?? {},
            parentId,
            graphRoot,
          }),
        })
      }
      return chunks.length > 0 ? chunks : null
    }
    if (data.type === 'user') {
      const results = blocks.filter(
        (block) => block.type === 'tool_result' && block.tool_use_id !== undefined,
      )
      const chunks = results.map((block): AgentCliChunk => {
        const id = block.tool_use_id ?? ''
        return {
          type: 'step-end',
          id,
          outcome: summarizeClaudeToolResult({
            tool: tools.get(id) ?? null,
            isError: block.is_error === true,
            content: block.content,
            // The structured result describes the message's one result.
            structured: results.length === 1 ? data.tool_use_result : undefined,
          }),
        }
      })
      return chunks.length > 0 ? chunks : null
    }
    return null
  }
}

/**
 * Parse one stdout line with a fresh parser (no graph root, no per-run tool
 * memory) — enough for text, results, and single-line activity.
 */
export function parseClaudeCliLine(line: string): AgentCliChunk | AgentCliChunk[] | null {
  return createClaudeCliLineParser('')(line)
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
  /** Edit mode: the agent may create and modify notes (private ones stay fenced). */
  allowEdits?: boolean
  /** The active agent's soul + memories for prompt injection. */
  agentContext?: AgentPromptContext | null
  /** Stage memory writes as pending proposals instead of direct edits. */
  memoryWriteApproval?: boolean
  /**
   * MCP servers resolved for this run ([] = none). The caller supplies them
   * only when the user enabled Tools or selected Full Access.
   */
  mcpServers?: ResolvedMcpServer[] | undefined
  /** Aborts the run mid-stream (the UI's stop button). */
  signal?: AbortSignal | undefined
  /**
   * Mid-turn steering, for engines whose steer mode is 'inject' (see
   * `cliProviderSteerMode`): once the run is live, `onSteerReady` receives
   * a function that delivers one more user message into the same session —
   * the CLI may absorb it into the active turn or queue a following turn
   * with full context, no cancel-and-relaunch. A rejected call means the run no longer accepts
   * input (settled or stopped) — queue the message instead. Engines
   * without an injection channel ignore this.
   */
  steering?: { onSteerReady: (steer: (text: string) => Promise<void>) => void } | undefined
}

/** Media types Claude Code reads natively from a stream-json user message. */
const CLAUDE_CLI_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

/** Whether Claude Code can take an attachment of this media type as a content block. */
export function claudeCliAcceptsAttachment(mediaType: string): boolean {
  return CLAUDE_CLI_IMAGE_TYPES.has(mediaType) || mediaType === 'application/pdf'
}

/**
 * One `--input-format stream-json` stdin line carrying a user message. The
 * streaming-input session may absorb the message into its active turn.
 * Attachments ride as Messages-API content blocks after the text — images
 * as `image`, PDFs as `document` — each preceded by its label so the
 * prompt's `[Attachment N: name]` markers resolve.
 */
export function claudeStreamJsonUserLine(
  text: string,
  attachments: readonly AgentCliAttachment[] = [],
): string {
  return JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'text', text },
        ...attachments.flatMap((attachment) => [
          { type: 'text', text: `[${attachment.label}]` },
          {
            type: attachment.mediaType === 'application/pdf' ? 'document' : 'image',
            source: { type: 'base64', media_type: attachment.mediaType, data: attachment.base64 },
          },
        ]),
      ],
    },
  })
}

/** Run one chat turn through the Claude Code CLI (see `./agent-cli`). */
export function streamClaudeCliChat(
  options: StreamCliChatOptions,
): AsyncGenerator<ChatStreamEvent> {
  const steering = options.steering
  const input = agentCliInput(options.messages, claudeCliAcceptsAttachment)
  // Attachments need the stream-json input channel (content blocks); so does
  // steering. A plain question keeps the simple text prompt.
  const streamingInput = steering !== undefined || input.attachments.length > 0
  return streamAgentCliTurn({
    binary: 'claude',
    args: claudeCliArgs({
      model: options.model,
      systemPrompt: claudeCliSystemPrompt({
        today: options.today,
        graphName: options.graphName,
        customSystemPrompt: options.customSystemPrompt,
        allowEdits: options.allowEdits,
        agentContext: options.agentContext,
        memoryWriteApproval: options.memoryWriteApproval,
        mcpServerNames: (options.mcpServers ?? []).map((server) => server.name),
      }),
      settingsJson: claudeCliSettingsJson(
        options.graphRoot,
        options.privateNotePaths,
        options.allowEdits === true,
        (options.mcpServers ?? []).map((server) => server.name),
      ),
      allowEdits: options.allowEdits,
      mcpServers: options.mcpServers,
      streamingInput,
    }),
    // In streaming-input mode the prompt itself rides as the first
    // stream-json user line — the same channel later steers arrive on.
    prompt: streamingInput
      ? `${claudeStreamJsonUserLine(input.text, input.attachments)}\n`
      : input.text,
    cwd: options.graphRoot,
    env: mcpSpawnEnv(options.mcpServers ?? []),
    parseLine: createClaudeCliLineParser(options.graphRoot),
    startFailureMessage: 'Could not start the Claude Code CLI.',
    signal: options.signal,
    steering:
      steering !== undefined
        ? {
            encodeLine: (text) => claudeStreamJsonUserLine(text),
            onReady: steering.onSteerReady,
            // Claude can absorb queued input into the active turn and emit one result.
            resultMode: 'same-turn',
          }
        : undefined,
  })
}
