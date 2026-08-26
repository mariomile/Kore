import type { AgentCliChunk } from './agent-cli'

/**
 * Codex app-server JSON-RPC helpers: handshake lines, stdout parse, and
 * the ids the live session uses to send `turn/start` / `turn/steer`.
 */

/** JSON-RPC request ids for the handshake (steer ids start after). */
export const CODEX_INITIALIZE_ID = 1
export const CODEX_THREAD_START_ID = 2
export const CODEX_TURN_START_ID = 3
export const CODEX_FIRST_STEER_ID = 4

export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function jsonRpcLine(payload: Record<string, unknown>): string {
  return JSON.stringify(payload)
}

function recordField(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const nested = value[key]
  return isJsonRecord(nested) ? nested : null
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
  /** Omit for the CLI's configured default model. */
  model?: string | undefined
}): string {
  const threadParams: Record<string, unknown> = {
    cwd: options.graphRoot,
    approvalPolicy: 'never',
    ephemeral: true,
  }
  if (options.model !== undefined) {
    threadParams.model = options.model
  }
  return [
    jsonRpcLine({
      method: 'initialize',
      id: CODEX_INITIALIZE_ID,
      params: { clientInfo: { name: 'lore', title: 'Kore' } },
    }),
    jsonRpcLine({ method: 'initialized', params: {} }),
    jsonRpcLine({
      method: 'thread/start',
      id: CODEX_THREAD_START_ID,
      params: threadParams,
    }),
  ].join('\n')
}

function rpcErrorMessage(value: unknown): string | null {
  if (!isJsonRecord(value)) {
    return null
  }
  if (typeof value.message === 'string' && value.message !== '') {
    return value.message
  }
  const nested = value.error
  if (isJsonRecord(nested) && typeof nested.message === 'string' && nested.message !== '') {
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
  if (!isJsonRecord(parsed)) {
    return null
  }

  const rpcError = rpcErrorMessage(parsed.error)
  if (rpcError !== null && parsed.id !== undefined) {
    return { type: 'result', isError: true, message: rpcError }
  }

  const method = typeof parsed.method === 'string' ? parsed.method : null
  const params = isJsonRecord(parsed.params) ? parsed.params : null

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
        error === null
          ? 'Codex turn failed.'
          : (stringField(error, 'message') ?? 'Codex turn failed.')
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

/**
 * The id both start events carry, whichever way it arrives: as the response
 * to our own start request (keyed by its request id) or as the server's
 * `thread/started` / `turn/started` notification. Thread and turn are the
 * same walk with different names, so there is one walk.
 */
function idFromAppServerLine(
  parsed: Record<string, unknown>,
  requestId: number,
  startedMethod: string,
  key: string,
): string | null {
  const container =
    parsed.id === requestId
      ? recordField(parsed, 'result')
      : parsed.method === startedMethod
        ? recordField(parsed, 'params')
        : null
  const entity = container === null ? null : recordField(container, key)
  return entity === null ? null : stringField(entity, 'id')
}

export function threadIdFromAppServerLine(parsed: Record<string, unknown>): string | null {
  return idFromAppServerLine(parsed, CODEX_THREAD_START_ID, 'thread/started', 'thread')
}

export function turnIdFromAppServerLine(parsed: Record<string, unknown>): string | null {
  return idFromAppServerLine(parsed, CODEX_TURN_START_ID, 'turn/started', 'turn')
}

export function codexTurnStartLine(threadId: string, userPrompt: string): string {
  return jsonRpcLine({
    method: 'turn/start',
    id: CODEX_TURN_START_ID,
    params: {
      threadId,
      input: [{ type: 'text', text: userPrompt }],
    },
  })
}

export function codexTurnSteerLine(
  requestId: number,
  threadId: string | undefined,
  turnId: string | undefined,
  text: string,
): string {
  return jsonRpcLine({
    method: 'turn/steer',
    id: requestId,
    params: {
      threadId,
      expectedTurnId: turnId,
      input: [{ type: 'text', text }],
    },
  })
}
