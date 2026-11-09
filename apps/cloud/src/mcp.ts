import { z } from 'zod'
import type { NoteStore } from './store'
import {
  INSTRUCTIONS,
  INSTRUCTIONS_CONTRACT_MAX_CHARS,
  TOOLS,
  callTool,
  vaultContract,
} from './tools'

/**
 * Kore Cloud's MCP endpoint: JSON-RPC over plain HTTP POST, one response per
 * request and no session state, so any Worker isolate can answer any call.
 * `initialize` is still answered for clients that send it.
 */

/** Protocol revisions this server speaks, newest first. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const

export const SERVER_INFO = { name: 'kore-cloud', title: 'Kore', version: '0.1.0' } as const

const rpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
})
type RpcRequest = z.infer<typeof rpcRequestSchema>

const toolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
})

/** Most calls one JSON-RPC batch may carry: each can touch D1 several times. */
export const MAX_BATCH = 10

type RpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } }

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INTERNAL_ERROR = -32603

/** Server instructions, with the vault's own contract inlined when it is short enough. */
export async function instructions(store: NoteStore): Promise<string> {
  const contract = await vaultContract(store)
  if (contract === null) {
    return INSTRUCTIONS
  }
  const text = contract.source.trim()
  if (text.length > INSTRUCTIONS_CONTRACT_MAX_CHARS) {
    return `${INSTRUCTIONS}\n\nThis vault has an agent contract at ${contract.path}; vault_guide returns it.`
  }
  return `${INSTRUCTIONS}\n\nThe vault's agent contract (${contract.path}):\n\n${text}`
}

function error(id: RpcRequest['id'], code: number, message: string): RpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

async function answer(store: NoteStore, request: RpcRequest): Promise<RpcResponse | null> {
  const { id, method, params } = request
  const isNotification = id === undefined
  if (method.startsWith('notifications/')) {
    return null
  }
  let result: unknown
  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion
      const protocolVersion =
        PROTOCOL_VERSIONS.find((version) => version === asked) ?? PROTOCOL_VERSIONS[0]
      result = {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: await instructions(store),
      }
      break
    }
    case 'ping':
      result = {}
      break
    case 'tools/list':
      result = {
        tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({
          name,
          description,
          inputSchema,
          annotations,
        })),
      }
      break
    case 'tools/call': {
      const call = toolCallSchema.safeParse(params)
      if (!call.success) {
        return error(id, INVALID_REQUEST, 'tools/call needs a name and object arguments')
      }
      result = await callTool(store, call.data.name, call.data.arguments ?? {})
      break
    }
    default:
      return isNotification ? null : error(id, METHOD_NOT_FOUND, `Unknown method ${method}`)
  }
  return isNotification ? null : { jsonrpc: '2.0', id: id ?? null, result }
}

async function safeAnswer(store: NoteStore, request: unknown): Promise<RpcResponse | null> {
  const parsed = rpcRequestSchema.safeParse(request)
  if (!parsed.success) {
    return error(null, INVALID_REQUEST, 'Expected a JSON-RPC request object with a method')
  }
  const rpc = parsed.data
  try {
    return await answer(store, rpc)
  } catch (cause) {
    console.error('mcp: request failed', cause)
    return error(rpc.id, INTERNAL_ERROR, 'Kore Cloud could not complete the request')
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Handle one HTTP request to `/mcp` (already authenticated). */
export async function handleMcp(request: Request, store: NoteStore): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { allow: 'POST' } })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(error(null, PARSE_ERROR, 'Body is not JSON'), 400)
  }
  if (Array.isArray(body)) {
    if (body.length > MAX_BATCH) {
      return json(error(null, INVALID_REQUEST, `At most ${MAX_BATCH} calls per batch`), 400)
    }
    const responses = (await Promise.all(body.map((item) => safeAnswer(store, item)))).filter(
      (response) => response !== null,
    )
    return responses.length === 0 ? new Response(null, { status: 202 }) : json(responses)
  }
  const response = await safeAnswer(store, body)
  return response === null ? new Response(null, { status: 202 }) : json(response)
}
