import { z } from 'zod'
import { call } from '../ipc/invoke'

/**
 * Agents' proposals (Plan 33, A2): writes an agent with a "propose" key
 * asked for, kept by the bundled CLI in `.kore/proposals/` until the owner
 * decides. The CLI also carries an accepted one out, rebuilding the call
 * through its MCP tool table and signing it as the agent, so the app only
 * lists, previews and decides.
 */

export const proposalSchema = z.object({
  id: z.string(),
  /** Milliseconds since the Unix epoch. */
  at: z.number(),
  agent: z.object({ name: z.string(), email: z.string() }),
  /** The MCP tool call as the agent sent it. */
  call: z.object({
    tool: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  }),
})
export type Proposal = z.infer<typeof proposalSchema>

const decisionSchema = z.looseObject({ id: z.string(), accepted: z.boolean() })

/** Every proposal waiting for the owner, oldest first. */
export async function listProposals(generation: number): Promise<Proposal[]> {
  return await call(
    'proposals_run',
    { generation, action: 'list', id: null },
    z.array(proposalSchema),
  )
}

/** Write proposal `id` as its agent, then drop it. Rejects with the CLI's message. */
export async function acceptProposal(generation: number, id: string): Promise<void> {
  await call('proposals_run', { generation, action: 'accept', id }, decisionSchema)
}

/** Drop proposal `id` without writing anything. */
export async function rejectProposal(generation: number, id: string): Promise<void> {
  await call('proposals_run', { generation, action: 'reject', id }, decisionSchema)
}

/** One line of a proposal's preview: text it adds, text it removes, or a detail. */
export interface ProposalLine {
  readonly kind: 'add' | 'remove' | 'detail'
  readonly text: string
}

/** What a person reads for a proposal before deciding. */
export interface ProposalPreview {
  /** What the write does, e.g. `Edit` or `Add to today's note`. */
  readonly action: string
  /** The note it targets, as the agent named it, when it names one. */
  readonly note: string | null
  readonly lines: readonly ProposalLine[]
}

function text(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  return value === undefined || value === null ? '' : JSON.stringify(value)
}

function optionalNote(value: unknown): string | null {
  const note = text(value).trim()
  return note === '' ? null : note
}

/**
 * The preview of a proposal, from its tool and arguments: the text it would
 * add or remove and the note it targets. Every argument the tool's own lines
 * leave out follows as a `key: value` detail, so what the owner accepts is
 * always what they read, whatever arguments a tool gains later.
 */
export function describeProposal(proposal: Proposal): ProposalPreview {
  const { shown, ...preview } = describeKnown(proposal)
  const rest = Object.entries(proposal.call.arguments)
    .filter(([key, value]) => !shown.includes(key) && text(value) !== '')
    .map(([key, value]): ProposalLine => ({ kind: 'detail', text: `${key}: ${text(value)}` }))
  return { ...preview, lines: [...preview.lines, ...rest] }
}

/** A tool's own preview, and the arguments it already shows. */
function describeKnown(proposal: Proposal): ProposalPreview & { shown: readonly string[] } {
  const args = proposal.call.arguments
  const add = (value: unknown): ProposalLine => ({ kind: 'add', text: text(value) })
  const remove = (value: unknown): ProposalLine => ({ kind: 'remove', text: text(value) })
  const detail = (value: string): ProposalLine => ({ kind: 'detail', text: value })
  switch (proposal.call.tool) {
    case 'capture': {
      const note = optionalNote(args.to)
      return {
        action: note === null ? "Add to today's note" : 'Add to',
        note,
        lines: [add(args.task === true ? `[ ] ${text(args.text)}` : args.text)],
        shown: ['to', 'task', 'text'],
      }
    }
    case 'append_to_note':
      return {
        action: 'Append to',
        note: optionalNote(args.note),
        lines: [add(args.markdown)],
        shown: ['note', 'markdown'],
      }
    case 'edit_note': {
      const old = text(args.oldText)
      return {
        action: 'Edit',
        note: optionalNote(args.note),
        lines: [...(old === '' ? [] : [remove(old)]), add(args.newText)],
        shown: ['note', 'oldText', 'newText'],
      }
    }
    case 'create_note': {
      const tags = Array.isArray(args.tags) ? args.tags.map(text) : []
      return {
        action: 'Create',
        note: optionalNote(args.title),
        lines: [
          ...(text(args.body) === '' ? [] : [add(args.body)]),
          ...(tags.length === 0 ? [] : [detail(tags.map((tag) => `#${tag}`).join(' '))]),
        ],
        shown: ['title', 'body', 'tags'],
      }
    }
    case 'set_properties': {
      const set =
        typeof args.set === 'object' && args.set !== null && !Array.isArray(args.set)
          ? Object.entries(args.set)
          : []
      const unset = Array.isArray(args.unset) ? args.unset.map(text) : []
      return {
        action: 'Set properties of',
        note: optionalNote(args.note),
        lines: [
          ...set.map(([key, value]) => add(`${key}: ${text(value)}`)),
          ...unset.map((key) => remove(key)),
        ],
        shown: ['note', 'set', 'unset'],
      }
    }
    case 'tag_note':
      return {
        action: 'Tag',
        note: optionalNote(args.note),
        lines: [add(`#${text(args.tag)}`)],
        shown: ['note', 'tag'],
      }
    case 'untag_note':
      return {
        action: 'Untag',
        note: optionalNote(args.note),
        lines: [remove(`#${text(args.tag)}`)],
        shown: ['note', 'tag'],
      }
    case 'complete_task': {
      const note = optionalNote(args.in)
      const verb = args.undo === true ? 'Reopen a task' : 'Tick off a task'
      return {
        action: note === null ? verb : `${verb} in`,
        note,
        lines: [detail(text(args.text))],
        shown: ['in', 'undo', 'text'],
      }
    }
    case 'remember': {
      const note = optionalNote(args.note)
      return {
        action: note === null ? "Remember in today's note" : 'Remember in',
        note,
        lines: [add(args.fact)],
        shown: ['note', 'fact'],
      }
    }
    default:
      return { action: proposal.call.tool, note: null, lines: [], shown: [] }
  }
}
