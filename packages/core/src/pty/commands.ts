import { z } from 'zod'
import { getBridge, type Unlisten } from '../ipc/bridge'
import { call } from '../ipc/invoke'

/** Typed bindings for the desktop PTY the in-app terminal drives. */

const voidSchema = z.null()

const ptyOpenSchema = z.object({
  id: z.string().min(1),
})

const ptyDataSchema = z.object({
  id: z.string().min(1),
  data: z.string(),
})

const ptyExitSchema = z.object({
  id: z.string().min(1),
  code: z.number().int().nullable(),
})

export type PtyOpenResult = z.infer<typeof ptyOpenSchema>
export type PtyDataEvent = z.infer<typeof ptyDataSchema>
export type PtyExitEvent = z.infer<typeof ptyExitSchema>

/** Spawn a shell in the open graph's root. Desktop-only. */
export function ptyOpen(cols: number, rows: number): Promise<PtyOpenResult> {
  return call('pty_open', { cols, rows }, ptyOpenSchema)
}

/** Write UTF-8 to an open PTY. */
export async function ptyWrite(id: string, data: string): Promise<void> {
  await call('pty_write', { id, data }, voidSchema)
}

/** Resize an open PTY to match the terminal viewport. */
export async function ptyResize(id: string, cols: number, rows: number): Promise<void> {
  await call('pty_resize', { id, cols, rows }, voidSchema)
}

/** Tear down an open PTY. Idempotent if the session is already gone. */
export async function ptyClose(id: string): Promise<void> {
  await call('pty_close', { id }, voidSchema)
}

/** Bytes the shell printed. */
export function subscribePtyData(handler: (event: PtyDataEvent) => void): Promise<Unlisten> {
  return getBridge().listen('pty:data', (payload) => {
    const parsed = ptyDataSchema.safeParse(payload)
    if (parsed.success) {
      handler(parsed.data)
    } else {
      console.error('invalid pty:data payload:', parsed.error)
    }
  })
}

/** The shell process exited. */
export function subscribePtyExit(handler: (event: PtyExitEvent) => void): Promise<Unlisten> {
  return getBridge().listen('pty:exit', (payload) => {
    const parsed = ptyExitSchema.safeParse(payload)
    if (parsed.success) {
      handler(parsed.data)
    } else {
      console.error('invalid pty:exit payload:', parsed.error)
    }
  })
}
