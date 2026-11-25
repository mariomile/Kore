import { z } from 'zod'
import { queryAgentCli } from './agent-cli'
import type { CliAgentProviderId } from './cli-providers'
import type { AiModelOption } from './provider-catalog'

/**
 * The model list a subscription CLI offers its signed-in account, read from
 * the CLI itself instead of the static catalog, which goes stale with every
 * model launch: Claude Code answers its SDK `initialize` control request with
 * `models`, Codex's app-server answers `model/list`. The catalog's `default`
 * entry (no model flag: the CLI's own setting) stays first, so saved
 * selections keep resolving. Null means "keep the catalog": the CLI is
 * missing, too old to answer, or Cursor (no model query).
 */

/** The transcript budget for a CLI model: the CLI manages its own context. */
const CLI_CONTEXT_WINDOW = 200_000

/** How long a CLI gets to start and answer before the catalog stands in. */
const QUERY_TIMEOUT_MS = 15_000

const DEFAULT_OPTION: AiModelOption = {
  id: 'default',
  label: 'CLI default',
  contextWindow: CLI_CONTEXT_WINDOW,
}

const claudeInitializeSchema = z.object({
  type: z.literal('control_response'),
  response: z.object({
    request_id: z.literal('models'),
    response: z.object({
      models: z.array(z.object({ value: z.string(), displayName: z.string() })),
    }),
  }),
})

const codexModelListSchema = z.object({
  id: z.literal(2),
  result: z.object({
    data: z.array(
      z.object({
        model: z.string(),
        displayName: z.string(),
        hidden: z.boolean().optional(),
      }),
    ),
  }),
})

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

/** The answer schema's data from one output line, or null for any other line. */
function lineData<T>(schema: z.ZodType<T>, line: string): T | null {
  const parsed = schema.safeParse(parseJson(line))
  return parsed.success ? parsed.data : null
}

/** `default` first, then the CLI's models in its own order. */
function withDefault(models: readonly { id: string; label: string }[]): AiModelOption[] {
  return [
    DEFAULT_OPTION,
    ...models
      .filter((model) => model.id !== DEFAULT_OPTION.id)
      .map((model) => ({ ...model, contextWindow: CLI_CONTEXT_WINDOW })),
  ]
}

async function claudeModels(): Promise<AiModelOption[] | null> {
  const answer = await queryAgentCli({
    binary: 'claude',
    // The SDK protocol without a prompt: no tools, no MCP, no model call.
    args: [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--tools',
      '',
      '--strict-mcp-config',
    ],
    input: `${JSON.stringify({
      type: 'control_request',
      request_id: 'models',
      request: { subtype: 'initialize' },
    })}\n`,
    answer: (line) => lineData(claudeInitializeSchema, line),
    timeoutMs: QUERY_TIMEOUT_MS,
  })
  return answer === null
    ? null
    : withDefault(
        answer.response.response.models.map((model) => ({
          id: model.value,
          label: model.displayName,
        })),
      )
}

async function codexModels(): Promise<AiModelOption[] | null> {
  const lines = [
    { id: 1, method: 'initialize', params: { clientInfo: { name: 'kore', version: '1' } } },
    { method: 'initialized' },
    { id: 2, method: 'model/list', params: {} },
  ]
  const answer = await queryAgentCli({
    binary: 'codex',
    args: ['app-server'],
    input: lines.map((line) => `${JSON.stringify(line)}\n`).join(''),
    // The chat runs' CODEX_HOME: the same sign-in, so the same models.
    isolatedCodexHome: true,
    answer: (line) => lineData(codexModelListSchema, line),
    timeoutMs: QUERY_TIMEOUT_MS,
  })
  return answer === null
    ? null
    : withDefault(
        answer.result.data
          .filter((model) => model.hidden !== true)
          .map((model) => ({ id: model.model, label: model.displayName })),
      )
}

/** The models `id`'s CLI offers right now, or null to keep the catalog. */
export async function listCliModels(id: CliAgentProviderId): Promise<AiModelOption[] | null> {
  switch (id) {
    case 'claude-cli':
      return await claudeModels()
    case 'codex-cli':
      return await codexModels()
    case 'cursor-cli':
      return null
  }
}
