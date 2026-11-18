import { z } from 'zod'
import { call } from '../ipc/invoke'

/**
 * Typed bindings for the OS-keychain commands (Plan 10, shared by Plan 12).
 * Every credential — BYOK AI keys, the GitHub backup token — goes through
 * here and **only** here: never into markdown, Git, `.kore/`, or the
 * settings document. Which keys exist is each domain's policy (`ai/secrets`
 * names the AI entries, `sync/github` the GitHub one); this module is just
 * the storage primitive.
 */

/** Commands that return `()` from Rust serialize as `null` over IPC. */
const voidSchema = z.null()

const secretSchema = z.string().nullable()

/** Store `value` in the OS keychain under `name`, replacing any prior value. */
export async function setSecret(name: string, value: string): Promise<void> {
  await call('secret_set', { name, value }, voidSchema)
}

/** Read the secret stored under `name`, or `null` when none exists. */
export async function getSecret(name: string): Promise<string | null> {
  return await call('secret_get', { name }, secretSchema)
}

/** Remove the secret stored under `name` (a missing entry is not an error). */
export async function deleteSecret(name: string): Promise<void> {
  await call('secret_delete', { name }, voidSchema)
}

/**
 * Read a secret stored as JSON and check it against `schema`. A missing,
 * malformed or out-of-shape entry is `null`: the caller treats it as never
 * set (the user reconnects), never as an error.
 */
export async function getJsonSecret<T>(name: string, schema: z.ZodType<T>): Promise<T | null> {
  const raw = await getSecret(name)
  if (raw === null) {
    return null
  }
  try {
    const parsed = schema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Store `value` as JSON under `name`; read it back with {@link getJsonSecret}. */
export async function setJsonSecret(name: string, value: unknown): Promise<void> {
  await setSecret(name, JSON.stringify(value))
}
