import type { ToolExecutionOptions, TypedToolCall, TypedToolResult } from 'ai'
import { errorMessage } from '../../errors'
import { loadAiSdk } from '../load-sdk'
import type { NoteTools } from './tools'
import {
  noteToolCall,
  noteToolResult,
  type NoteToolCall,
  type NoteToolResult,
} from './tools-activity'

/**
 * The chat tools, run by the app for an agent loop that lives outside it.
 *
 * The API-key engine hands the tool set to the AI SDK, which validates each
 * call and executes it in process. A harness with its own loop (pi) only
 * needs to know what the tools look like and to get each call answered; this
 * module is that seam. It keeps one tool catalog for every engine: the same
 * schemas, the same executors (privacy gate included), and the same
 * {@link NoteToolCall}/{@link NoteToolResult} activity the transcript
 * renders — so a proposal card looks and behaves the same whoever asked.
 */

/** One tool as a harness declares it to its model. */
export interface HostToolSpec {
  name: string
  description: string
  /** The input's JSON Schema. */
  parameters: unknown
}

/** One tool call a harness asks the app to answer. */
export interface HostToolRequest {
  toolCallId: string
  name: string
  input: unknown
}

/** How a hosted call ended: the model-facing output, or a refusal to relay. */
export type HostToolOutcome =
  | { ok: true; output: unknown; result: NoteToolResult | null }
  | { ok: false; error: string }

export interface HostToolRunner {
  /** The tools the harness may call this turn. */
  specs: HostToolSpec[]
  /** The call as the transcript shows it, or null when it is not a valid call. */
  describe: (request: HostToolRequest) => Promise<NoteToolCall | null>
  /** Validate and execute one call. Never throws. */
  run: (request: HostToolRequest, signal?: AbortSignal) => Promise<HostToolOutcome>
}

type AnyExecute = (input: unknown, options: ToolExecutionOptions<unknown>) => unknown

/** Build the runner over `tools`, exposing only the `active` names. */
export async function createHostToolRunner(
  tools: NoteTools,
  active: readonly (keyof NoteTools)[],
): Promise<HostToolRunner> {
  const { asSchema } = await loadAiSdk()
  const schemas = new Map(
    active.map((name) => [
      name as string,
      { name, schema: asSchema<unknown>(tools[name].inputSchema) },
    ]),
  )
  const specs = await Promise.all(
    [...schemas.values()].map(async ({ name, schema }): Promise<HostToolSpec> => {
      const description = tools[name].description
      return {
        name,
        description: typeof description === 'string' ? description : '',
        parameters: await schema.jsonSchema,
      }
    }),
  )

  /** The request with its input checked against the tool's own schema. */
  const validated = async (
    request: HostToolRequest,
  ): Promise<{ name: keyof NoteTools; input: unknown } | { error: string }> => {
    const entry = schemas.get(request.name)
    if (entry === undefined) {
      return { error: `Unknown tool: ${request.name}` }
    }
    const checked = await entry.schema.validate?.(request.input)
    if (checked === undefined) {
      return { name: entry.name, input: request.input }
    }
    return checked.success
      ? { name: entry.name, input: checked.value }
      : { error: `Invalid input for ${request.name}: ${errorMessage(checked.error)}` }
  }

  return {
    specs,
    describe: async (request) => {
      const call = await validated(request)
      if ('error' in call) {
        return null
      }
      // The mapper is typed on the SDK's stream parts; the input was just
      // validated by the same schema the SDK would have used.
      return noteToolCall({
        type: 'tool-call',
        toolCallId: request.toolCallId,
        toolName: call.name,
        input: call.input,
      } as TypedToolCall<NoteTools>)
    },
    run: async (request, signal) => {
      const call = await validated(request)
      if ('error' in call) {
        return { ok: false, error: call.error }
      }
      const execute = tools[call.name].execute as AnyExecute | undefined
      if (execute === undefined) {
        return { ok: false, error: `Tool ${request.name} cannot run here.` }
      }
      try {
        const output = await execute(call.input, {
          toolCallId: request.toolCallId,
          messages: [],
          context: undefined,
          ...(signal !== undefined ? { abortSignal: signal } : {}),
        })
        const result = noteToolResult({
          type: 'tool-result',
          toolCallId: request.toolCallId,
          toolName: call.name,
          input: call.input,
          output,
        } as TypedToolResult<NoteTools>)
        return { ok: true, output, result }
      } catch (cause) {
        return { ok: false, error: errorMessage(cause) }
      }
    },
  }
}
