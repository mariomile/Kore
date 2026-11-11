import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { z } from 'zod'
import { appErrorSchema } from '../errors'
import type { IpcBridge } from '../ipc/bridge'

/**
 * An {@link IpcBridge} over newline-delimited JSON, for a headless host that
 * runs `@kore/core` in Node and answers its native commands from another
 * process: the `kore index` CLI spawns Node with pipes and serves every
 * request with the same Rust code the desktop app's commands use.
 *
 * Wire shape, one JSON object per line:
 * - request (Node → host): `{"id": 1, "command": "note_read", "args": {...}}`
 * - reply (host → Node): `{"id": 1, "ok": <value>}` or
 *   `{"id": 1, "error": {"kind": "notFound", "message": "..."}}`
 *
 * The error object is an `AppError`, so core call sites branch on `kind`
 * exactly as they do over Tauri. A headless host has no event bus: `listen`
 * subscribes to nothing.
 */

const replySchema = z.union([
  z.object({ id: z.number(), ok: z.unknown() }),
  z.object({ id: z.number(), error: appErrorSchema }),
])

interface PendingCall {
  readonly resolve: (value: unknown) => void
  readonly reject: (reason: unknown) => void
}

/** A stdio bridge plus a way to stop reading once the work is done. */
export interface StdioBridge extends IpcBridge {
  /** Stop reading replies; calls still pending reject. */
  readonly close: () => void
}

/** Build a bridge that writes requests to `output` and reads replies from `input`. */
export function createStdioBridge(input: Readable, output: Writable): StdioBridge {
  const pending = new Map<number, PendingCall>()
  let nextId = 1
  const lines = createInterface({ input, crlfDelay: Infinity })

  function rejectPending(message: string): void {
    for (const call of pending.values()) {
      call.reject({ kind: 'io', message })
    }
    pending.clear()
  }

  function parseReply(line: string): z.infer<typeof replySchema> | undefined {
    try {
      const parsed = replySchema.safeParse(JSON.parse(line))
      return parsed.success ? parsed.data : undefined
    } catch {
      return undefined
    }
  }

  lines.on('line', (line) => {
    if (line.trim() === '') {
      return
    }
    const reply = parseReply(line)
    if (reply === undefined) {
      // The stream is out of sync with the host: no later reply can be
      // trusted to match its call, so fail everything still waiting.
      rejectPending('malformed reply from the indexer host')
      lines.close()
      return
    }
    const call = pending.get(reply.id)
    if (call === undefined) {
      return
    }
    pending.delete(reply.id)
    if ('error' in reply) {
      call.reject(reply.error)
    } else {
      call.resolve(reply.ok)
    }
  })
  lines.on('close', () => {
    rejectPending('the indexer host closed the connection')
  })

  return {
    invoke: async (command, args) => {
      const id = nextId
      nextId += 1
      const result = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject })
      })
      output.write(`${JSON.stringify({ id, command, args })}\n`)
      return await result
    },
    listen: async () => () => {},
    close: () => {
      lines.close()
    },
  }
}
