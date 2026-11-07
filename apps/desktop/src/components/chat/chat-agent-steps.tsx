import { useState, type MouseEvent, type ReactElement } from 'react'
import {
  agentStepTree,
  isSubagentTool,
  type AgentStepNode,
  type AssistantPart,
  type ChatTurn,
} from '@reflect/core'
import { isModEvent } from '@meowdown/core'
import {
  Bot,
  Checklist,
  ChevronDown,
  ChevronRight,
  Note,
  Pencil,
  Plug,
  Search,
  Sparkles,
} from '@/components/icons'
import { Spinner } from '@/components/ui/spinner'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { routeForPath } from '@/routing/route'
import { cn } from '@/lib/utils'

type StepPart = Extract<AssistantPart, { kind: 'step' }>
type StepNode = AgentStepNode<StepPart>

interface ChatAgentStepsProps {
  /** One run of consecutive steps, in stream order (subagent steps included). */
  steps: readonly StepPart[]
  turnStatus: ChatTurn['status']
}

function isRunning(part: StepPart): boolean {
  return part.outcome === null
}

/** The step shown in a collapsed header while the run works: the newest running one. */
function currentStep(steps: readonly StepPart[]): StepPart | null {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (step !== undefined && isRunning(step)) {
      return step
    }
  }
  return null
}

function stepIcon(tool: string): ReactElement {
  const className = 'size-3.5 shrink-0'
  if (isSubagentTool(tool)) {
    return <Bot aria-hidden className={className} />
  }
  switch (tool) {
    case 'Read':
      return <Note aria-hidden className={className} />
    case 'Glob':
    case 'Grep':
      return <Search aria-hidden className={className} />
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return <Pencil aria-hidden className={className} />
    case 'TodoWrite':
      return <Checklist aria-hidden className={className} />
    default:
      return tool.startsWith('mcp__') ? (
        <Plug aria-hidden className={className} />
      ) : (
        <Sparkles aria-hidden className={className} />
      )
  }
}

/** File tools name a graph-relative markdown path; those open the note. */
function notePath(part: StepPart): string | null {
  const { tool, detail } = part.step
  const fileTool = tool === 'Read' || tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit'
  return fileTool && detail !== null && detail.endsWith('.md') && !detail.startsWith('/')
    ? detail
    : null
}

function StepDetail({ part }: { part: StepPart }): ReactElement | null {
  const navigate = useNoteLinkNavigation()
  const path = notePath(part)
  if (part.step.detail === null) {
    return null
  }
  if (path === null) {
    return <span className="min-w-0 truncate text-text-muted">{part.step.detail}</span>
  }
  return (
    <button
      type="button"
      title={path}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        navigate({
          target: routeForPath(path),
          openInSplit: isModEvent(event),
        })
      }}
      className="min-w-0 truncate text-left text-text-muted underline-offset-2 hover:text-text hover:underline"
    >
      {path}
    </button>
  )
}

function StepOutcome({ part }: { part: StepPart }): ReactElement | null {
  if (part.outcome?.error != null) {
    return (
      <span className="min-w-0 truncate text-destructive" title={part.outcome.error}>
        {part.outcome.error}
      </span>
    )
  }
  if (part.outcome?.summary != null) {
    return <span className="shrink-0 text-text-muted">· {part.outcome.summary}</span>
  }
  return null
}

function StepRow({ part }: { part: StepPart }): ReactElement {
  return (
    <li className="flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
      {isRunning(part) ? <Spinner className="size-3.5 shrink-0" /> : stepIcon(part.step.tool)}
      <span className="shrink-0 text-text">{part.step.label}</span>
      <StepDetail part={part} />
      <StepOutcome part={part} />
    </li>
  )
}

/** A subagent: its own card, with the steps it ran nested inside. */
function SubagentCard({ node }: { node: StepNode }): ReactElement {
  const part = node.item
  const children = flatten(node.children)
  return (
    <li className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        {isRunning(part) ? (
          <Spinner className="size-3.5 shrink-0" />
        ) : (
          <Bot aria-hidden className="size-3.5 shrink-0 text-text-muted" />
        )}
        <span className="shrink-0 font-medium text-text">{part.step.label}</span>
        {part.step.detail !== null ? (
          <span className="min-w-0 truncate text-text-muted">{part.step.detail}</span>
        ) : null}
        <StepOutcome part={part} />
      </div>
      {children.length > 0 ? (
        <ul className="ml-1.5 flex min-w-0 flex-col gap-1 border-l border-border pl-2.5">
          {children.map((child) =>
            isSubagentTool(child.item.step.tool) ? (
              <SubagentCard key={child.item.step.id} node={child} />
            ) : (
              <StepRow key={child.item.step.id} part={child.item} />
            ),
          )}
        </ul>
      ) : null}
    </li>
  )
}

/**
 * A subagent's nested steps, in order. Non-subagent steps cannot have
 * children of their own, so their (impossible) children are lifted up rather
 * than lost; nested subagents keep their own card.
 */
function flatten(nodes: readonly StepNode[]): StepNode[] {
  return nodes.flatMap((node) =>
    isSubagentTool(node.item.step.tool) ? [node] : [node, ...flatten(node.children)],
  )
}

/**
 * The tool activity a CLI engine ran in its own loop, as one collapsible
 * block: "Working" with the live step while the run is busy, "Worked · N
 * steps" once it settles. Open while the turn streams so the user watches
 * the agent work, folded once it is done; a click overrides either way.
 * Subagents render as cards holding their own steps.
 */
export function ChatAgentSteps({ steps, turnStatus }: ChatAgentStepsProps): ReactElement {
  const [toggled, setToggled] = useState<boolean | null>(null)
  const streaming = turnStatus === 'streaming'
  const open = toggled ?? streaming
  const live = streaming ? currentStep(steps) : null
  const failed = steps.filter((part) => part.outcome?.error != null).length
  const tree = agentStepTree(steps)
  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <div className="flex max-w-full min-w-0 flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setToggled(!open)}
        className="flex min-w-0 items-center gap-1.5 self-start rounded-md text-xs text-text-muted hover:text-text"
      >
        {live !== null ? <Spinner className="size-3.5 shrink-0" /> : null}
        <span className={cn('shrink-0', live !== null && 'text-text')}>
          {live !== null
            ? 'Working'
            : `Worked · ${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`}
        </span>
        {live !== null ? (
          <span className="min-w-0 truncate">
            {live.step.label}
            {live.step.detail !== null ? ` ${live.step.detail}` : ''}
          </span>
        ) : failed > 0 ? (
          <span className="shrink-0 text-destructive">· {failed} failed</span>
        ) : null}
        <Chevron aria-hidden className="size-3.5 shrink-0" />
      </button>
      {open ? (
        <ul className="flex min-w-0 flex-col gap-1 pl-1" aria-label="Agent steps">
          {tree.flatMap((node) =>
            isSubagentTool(node.item.step.tool)
              ? [<SubagentCard key={node.item.step.id} node={node} />]
              : flatten([node]).map((flat) => <StepRow key={flat.item.step.id} part={flat.item} />),
          )}
        </ul>
      ) : null}
    </div>
  )
}
