import type { Tool } from 'ai'
import { z } from 'zod'
import type { BrainCommand, BrainResult } from '../../cyber-brain/script'
import { tool } from './define-tool'

/**
 * The cyber-brain memory tools for the API-key chat (Plan 35): the same five
 * tools `kore mcp` serves to agent CLIs, ChatGPT and Grok, with the same
 * names and fields, each running the vault's own `brain.mjs` through the
 * desktop's gated `kit_script_run`. They exist only in a kit vault (the
 * engine lists them as active tools only then) and only write with "Allow
 * edits" on. Writes land directly, as from every other agent: the kit keeps a
 * run record of each one, shown in the Memory view.
 */

const text = (description: string) => z.string().trim().min(1).describe(description)
const optional = (description: string) => z.string().trim().min(1).optional().describe(description)

export const rememberMemoryInput = z.object({
  text: text("The memory, one line, in the vault's language"),
  kind: z
    .enum(['fact', 'block', 'observation', 'lesson'])
    .optional()
    .describe('fact (default), block (identity: NOW, USER or SOUL), observation, or lesson'),
  source: optional('Where it came from: a meeting, a chat, a document (required unless a lesson)'),
  target: optional('The note it belongs in, or NOW/USER/SOUL for a block'),
  replaces: optional('The line this one replaces, kept as was:'),
  since: optional('YYYY-MM-DD the fact holds from (default today)'),
})

export const openLoopInput = z.object({
  title: text('What has to happen, one line'),
  owner: optional('Who owes it (default the user)'),
  due: optional('YYYY-MM-DD it is due'),
  resurface: optional('YYYY-MM-DD to bring it back up'),
  state: optional('Where it stands now'),
  context: optional('The note or meeting it comes from'),
  status: z.enum(['open', 'waiting-user']).optional(),
})

export const updateLoopInput = z.object({
  id: text("The loop's id (loop-…)"),
  state: optional('Where it stands now'),
  status: z.enum(['open', 'waiting-user', 'closed']).optional(),
  resurface: optional('YYYY-MM-DD to bring it back up'),
  owner: optional('Who owes it now'),
})

export const closeLoopInput = z.object({
  id: text("The loop's id (loop-…)"),
  outcome: text('How it ended, one line'),
})

export const recordDecisionInput = z.object({
  title: text('Short title'),
  description: text('One line: what was decided about'),
  decision: text('What was decided'),
  context: optional('Why it came up'),
  options: optional('The options considered'),
  tradeoffs: optional('What it costs, what it buys'),
})

/** What a memory tool returns: the kit's own summary, or its refusal. */
export type MemoryWriteOutput =
  | { ok: true; output: string; commit: string | null }
  | { ok: false; error: string }

/** The memory tools' names, for the engine's active-tool list. */
export const MEMORY_TOOL_NAMES = [
  'remember',
  'open_loop',
  'update_loop',
  'close_loop',
  'record_decision',
] as const

export type MemoryToolName = (typeof MEMORY_TOOL_NAMES)[number]

export const MEMORY_EDITS_DISABLED_ERROR =
  'Memory writes need "Allow edits" — the user can turn it on in the chat settings. Tell them what you would save instead.'

export const MEMORY_KIT_ABSENT_ERROR =
  'This vault has no cyber-brain memory kit, so there is nowhere to write this memory.'

export interface MemoryToolDeps {
  /** Runs one kit command in the open vault; null when the vault has no kit. */
  memoryWriteFn?: ((command: BrainCommand) => Promise<BrainResult>) | null
  allowEdits: boolean
}

export type MemoryTools = {
  remember: Tool<z.infer<typeof rememberMemoryInput>, MemoryWriteOutput>
  open_loop: Tool<z.infer<typeof openLoopInput>, MemoryWriteOutput>
  update_loop: Tool<z.infer<typeof updateLoopInput>, MemoryWriteOutput>
  close_loop: Tool<z.infer<typeof closeLoopInput>, MemoryWriteOutput>
  record_decision: Tool<z.infer<typeof recordDecisionInput>, MemoryWriteOutput>
}

/** Drop the fields the model left out, so the kit gets no empty flags. */
function given<T extends object>(input: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>
  }
}

/** Build the five memory tools over `deps`. */
export function buildMemoryTools(deps: MemoryToolDeps): MemoryTools {
  const write = async (command: BrainCommand): Promise<MemoryWriteOutput> => {
    if (!deps.allowEdits) return { ok: false, error: MEMORY_EDITS_DISABLED_ERROR }
    if (deps.memoryWriteFn == null) return { ok: false, error: MEMORY_KIT_ABSENT_ERROR }
    return await deps.memoryWriteFn(command)
  }
  return {
    remember: tool({
      description:
        "Keep one durable memory the way the vault's cyber-brain kit does: a fact line `- fact [source: …; since: …]` in the note it belongs to, with a run record and a commit. Give `source` for anything but a lesson; give `replaces` with the old line when a fact changes.",
      inputSchema: rememberMemoryInput,
      execute: async ({ kind, ...input }): Promise<MemoryWriteOutput> =>
        await write({ ...given(input), kind: 'remember', memory: kind ?? 'fact' }),
    }),
    open_loop: tool({
      description:
        "Open a loop (something someone owes or must come back to) with the vault's kit. Dates are YYYY-MM-DD: resolve “Friday” or “tomorrow” from today's date yourself.",
      inputSchema: openLoopInput,
      execute: async (input): Promise<MemoryWriteOutput> =>
        await write({ ...given(input), kind: 'loop-open' }),
    }),
    update_loop: tool({
      description:
        'Update an open loop by its id: where it stands, its status, when to resurface it, or who owns it.',
      inputSchema: updateLoopInput,
      execute: async (input): Promise<MemoryWriteOutput> =>
        await write({ ...given(input), kind: 'loop-update' }),
    }),
    close_loop: tool({
      description: 'Close a loop by its id with how it ended.',
      inputSchema: closeLoopInput,
      execute: async (input): Promise<MemoryWriteOutput> =>
        await write({ ...given(input), kind: 'loop-close' }),
    }),
    record_decision: tool({
      description:
        "Record a decision the user took as its own decision note in the vault's kit format. Only a decision actually taken, not a hypothesis.",
      inputSchema: recordDecisionInput,
      execute: async (input): Promise<MemoryWriteOutput> =>
        await write({ ...given(input), kind: 'decision' }),
    }),
  }
}

/** One line for the chip: what the tool was asked to keep. */
export function memoryToolLabel(name: MemoryToolName, input: Record<string, unknown>): string {
  const field = (key: string): string => (typeof input[key] === 'string' ? input[key] : '')
  switch (name) {
    case 'remember':
      return field('text')
    case 'open_loop':
      return field('title')
    case 'update_loop':
    case 'close_loop':
      return field('id')
    case 'record_decision':
      return field('title')
  }
}
