/**
 * Agent steps: the tool activity a CLI engine (Claude Code) runs inside its
 * own loop — file reads, globs, edits, MCP calls, subagents — surfaced in
 * the transcript so a run is no longer a black box behind "Thinking…".
 *
 * A step carries only what identifies it on screen (tool, a short label,
 * the path or pattern it touched) and its outcome as a short summary — never
 * the tool's output. Read results are note content, and the transcript is
 * persisted, so content stays inside the CLI run where it belongs.
 *
 * Subagent steps carry `parentId`: the id of the `Agent` call that spawned
 * them (the stream's `parent_tool_use_id`), which is how the renderer nests
 * a subagent's work under its card.
 *
 * The engine's tool names stop here: a step also carries its `kind` and the
 * note it touched (`notePath`), so the renderer never switches on `Read`,
 * `Agent` or `mcp__…` and another engine only has to describe its own tools.
 */

/** What a step does, as the renderer shows it (its icon, whether it is a subagent card). */
export type AgentStepKind = 'read' | 'write' | 'search' | 'plan' | 'subagent' | 'mcp' | 'other'

/** One tool call the agent made, as the transcript records it. */
export interface AgentStep {
  /** The engine's tool-call id (unique within the run). */
  id: string
  /** The raw tool name (`Read`, `Glob`, `Agent`, `mcp__server__tool`…). */
  tool: string
  /** Short human label for the action, e.g. "Read", "Find files". */
  label: string
  /** What it acted on — a graph-relative path, a pattern, a task — or null. */
  detail: string | null
  /** The subagent call this step ran inside, or null for the main agent. */
  parentId: string | null
  kind: AgentStepKind
  /** The graph-relative note the step read or wrote, which the transcript opens; else null. */
  notePath: string | null
}

/** How a step ended: an error message, or a content-free summary of success. */
export interface AgentStepOutcome {
  error: string | null
  summary: string | null
}

/** The tool name a subagent call goes by (`Task` is the pre-2.1 spelling). */
function isSubagentTool(tool: string): boolean {
  return tool === 'Agent' || tool === 'Task'
}

/** The kind of one Claude Code tool. */
function claudeToolKind(tool: string): AgentStepKind {
  if (isSubagentTool(tool)) {
    return 'subagent'
  }
  switch (tool) {
    case 'Read':
      return 'read'
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'write'
    case 'Glob':
    case 'Grep':
      return 'search'
    case 'TodoWrite':
      return 'plan'
    default:
      return tool.startsWith('mcp__') ? 'mcp' : 'other'
  }
}

/** The tools whose path is a note the user can open from the transcript. */
const NOTE_TOOLS: ReadonlySet<string> = new Set(['Read', 'Write', 'Edit', 'MultiEdit'])

/** A graph-relative Markdown path one of {@link NOTE_TOOLS} touched, else null. */
function claudeNotePath(tool: string, path: string | null): string | null {
  return NOTE_TOOLS.has(tool) && path !== null && path.endsWith('.md') && !path.startsWith('/')
    ? path
    : null
}

/**
 * A step persisted before steps carried `kind` and `notePath`: derive both
 * from its tool, as the transcript renderer used to. Its `detail` is the
 * clipped relative path, so a clipped one opens nothing, as before.
 */
export function upgradeLegacyStep<T extends { tool: string; detail: string | null }>(
  step: T,
): T & Pick<AgentStep, 'kind' | 'notePath'> {
  return {
    ...step,
    kind: claudeToolKind(step.tool),
    notePath: claudeNotePath(step.tool, step.detail),
  }
}

/** How a step the privacy sandbox refused reads in the transcript. */
export const PRIVACY_DENIED = 'Blocked — private or protected file'

/** Longest detail or summary kept — a label, not a payload. */
const MAX_TEXT = 160

function clip(text: string): string {
  const oneLine = text.replaceAll(/\s+/g, ' ').trim()
  return oneLine.length > MAX_TEXT ? `${oneLine.slice(0, MAX_TEXT - 1)}…` : oneLine
}

function stringField(input: Record<string, unknown>, key: string): string | null {
  const value = input[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** A path relative to the graph root when it lies inside it. */
function relativePath(path: string, graphRoot: string): string {
  const root = graphRoot.replaceAll('\\', '/').replace(/\/+$/, '')
  const normalized = path.replaceAll('\\', '/')
  return root !== '' && normalized.startsWith(`${root}/`)
    ? normalized.slice(root.length + 1)
    : normalized
}

/** `mcp__notion__search_pages` → `search pages` on server `notion`. */
function mcpParts(tool: string): { server: string; name: string } | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (match === null) {
    return null
  }
  return {
    server: match[1] ?? '',
    name: (match[2] ?? '').replaceAll('_', ' '),
  }
}

/** Describe one Claude Code tool call for the transcript. */
export function describeClaudeToolCall(options: {
  id: string
  tool: string
  input: Record<string, unknown>
  parentId: string | null
  graphRoot: string
}): AgentStep {
  const { id, tool, input, parentId, graphRoot } = options
  const absolute = stringField(input, 'file_path') ?? stringField(input, 'notebook_path')
  const path = absolute === null ? null : relativePath(absolute, graphRoot)
  const pathDetail = path === null ? null : clip(path)
  const base = {
    id,
    tool,
    parentId,
    kind: claudeToolKind(tool),
    notePath: claudeNotePath(tool, path),
  }
  return { ...base, ...claudeToolText(tool, input, pathDetail) }
}

/** The label and detail one Claude Code tool call shows. */
function claudeToolText(
  tool: string,
  input: Record<string, unknown>,
  pathDetail: string | null,
): Pick<AgentStep, 'label' | 'detail'> {
  if (isSubagentTool(tool)) {
    return {
      label: subagentLabel(stringField(input, 'subagent_type')),
      detail: clipOrNull(stringField(input, 'description')),
    }
  }
  switch (tool) {
    case 'Read':
      return { label: 'Read', detail: pathDetail }
    case 'Write':
      return { label: 'Write', detail: pathDetail }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { label: 'Edit', detail: pathDetail }
    case 'Glob':
      return { label: 'Find files', detail: clipOrNull(stringField(input, 'pattern')) }
    case 'Grep':
      return { label: 'Search', detail: clipOrNull(stringField(input, 'pattern')) }
    case 'TodoWrite':
      return { label: 'Update plan', detail: null }
    default: {
      const mcp = mcpParts(tool)
      return mcp === null
        ? { label: clip(tool), detail: pathDetail }
        : { label: clip(mcp.name), detail: mcp.server }
    }
  }
}

function clipOrNull(text: string | null): string | null {
  return text === null ? null : clip(text)
}

/** "Subagent", or "Explore subagent" for a named non-default type. */
function subagentLabel(type: string | null): string {
  return type === null || type === 'general-purpose' ? 'Subagent' : `${clip(type)} subagent`
}

/** The readable text of a `tool_result` block's content. */
function resultText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .map((block: unknown) =>
        typeof block === 'object' &&
        block !== null &&
        'text' in block &&
        typeof block.text === 'string'
          ? block.text
          : '',
      )
      .join(' ')
  }
  return ''
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function numberField(value: unknown, key: string): number | null {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return null
  }
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'number' && Number.isFinite(field) ? field : null
}

/**
 * Summarize one Claude Code tool result without keeping its content: an
 * error keeps its (clipped, tag-stripped) message — a privacy denial is how
 * the user learns a note was off-limits — and a success keeps only counts
 * read from the structured `tool_use_result`.
 */
export function summarizeClaudeToolResult(options: {
  tool: string | null
  isError: boolean
  content: unknown
  structured: unknown
}): AgentStepOutcome {
  if (options.isError) {
    const message = clip(resultText(options.content).replaceAll(/<\/?tool_use_error>/g, ''))
    // The sandbox's deny rules (private notes, .kore/, .git/) answer in
    // CLI jargon; say what it means instead.
    if (/denied by your permission settings/i.test(message)) {
      return { error: PRIVACY_DENIED, summary: null }
    }
    return {
      error: message === '' ? 'The tool failed.' : message,
      summary: null,
    }
  }
  const structured = options.structured
  if (options.tool !== null && isSubagentTool(options.tool)) {
    const steps = numberField(structured, 'totalToolUseCount')
    const ms = numberField(structured, 'totalDurationMs')
    const parts = [
      ...(steps === null ? [] : [plural(steps, 'step')]),
      ...(ms === null ? [] : [`${Math.max(1, Math.round(ms / 1000))}s`]),
    ]
    return { error: null, summary: parts.length === 0 ? null : parts.join(' · ') }
  }
  switch (options.tool) {
    case 'Glob': {
      const files = numberField(structured, 'numFiles')
      return {
        error: null,
        summary: files === null ? null : plural(files, 'file'),
      }
    }
    case 'Read': {
      const file =
        typeof structured === 'object' && structured !== null && 'file' in structured
          ? structured.file
          : null
      const lines = numberField(file, 'numLines')
      return {
        error: null,
        summary: lines === null ? null : plural(lines, 'line'),
      }
    }
    default:
      return { error: null, summary: null }
  }
}

/** A step and the steps that ran inside it (a subagent's work). */
export interface AgentStepNode<T extends { step: AgentStep }> {
  item: T
  /** Only a subagent step has children. */
  children: AgentStepNode<T>[]
}

/**
 * Nest steps under the subagent calls that spawned them, preserving order.
 * Only a subagent step takes children; a step whose parent is missing or is
 * not a subagent (should not happen) stays where it ran rather than vanishing.
 */
export function agentStepTree<T extends { step: AgentStep }>(
  items: readonly T[],
): AgentStepNode<T>[] {
  const subagents = new Map<string, AgentStepNode<T>>()
  const roots: AgentStepNode<T>[] = []
  for (const item of items) {
    const node: AgentStepNode<T> = { item, children: [] }
    const parent = item.step.parentId === null ? undefined : subagents.get(item.step.parentId)
    const siblings = parent === undefined ? roots : parent.children
    siblings.push(node)
    if (item.step.kind === 'subagent') {
      subagents.set(item.step.id, node)
    }
  }
  return roots
}
