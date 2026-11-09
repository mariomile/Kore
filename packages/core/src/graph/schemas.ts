import { z } from 'zod'

/** Identity of an open graph (mirrors the Rust `GraphInfo`). */
export const graphInfoSchema = z.object({
  /** Absolute path of the graph root. */
  root: z.string(),
  /** Display name (the root folder name). */
  name: z.string(),
  /**
   * Open-session generation, bumped by Rust on every graph open. Mutating file
   * commands echo it back and are rejected when stale, so a write enqueued for
   * one graph can never land in another graph's same-named file.
   */
  generation: z.number(),
})
export type GraphInfo = z.infer<typeof graphInfoSchema>

/** A previously-opened graph (mirrors the Rust `RecentGraph`). */
export const recentGraphSchema = z.object({
  root: z.string(),
  name: z.string(),
  /** When it was last opened, epoch milliseconds. */
  openedMs: z.number(),
})
export type RecentGraph = z.infer<typeof recentGraphSchema>

/** Metadata for a file inside the graph (mirrors the Rust `FileMeta`). */
export const fileMetaSchema = z.object({
  /** Graph-relative path, forward-slashed. */
  path: z.string(),
  size: z.number(),
  /** Last-modified time in epoch milliseconds. */
  modifiedMs: z.number(),
  /**
   * True when the file is an iCloud eviction placeholder (Plan 21): the file
   * exists but its content is offloaded until re-download. It must not be
   * read — and must not be treated as deleted. Rust omits the field for
   * regular files.
   */
  placeholder: z.boolean().optional(),
})
export type FileMeta = z.infer<typeof fileMetaSchema>

/** Result of the native no-clobber note claim. */
export const noteCreateOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('created'), modifiedMs: z.number().nullable() }),
  z.object({ kind: z.literal('collision') }),
])
export type NoteCreateOutcome = z.infer<typeof noteCreateOutcomeSchema>

/**
 * What a secondary note window needs to boot (mirrors the Rust
 * `WindowBootstrap`): the open graph's identity with both session generations
 * **unbumped** — adoption is a read, never a re-open — plus the one-shot deep
 * link the window was created to show.
 */
export const windowBootstrapSchema = z.object({
  graph: graphInfoSchema,
  /** The open index session's generation, or null when no index is open. */
  indexGeneration: z.number().nullable(),
  /** The `kore://` link this window was opened for; absent on a reload. */
  initialDeepLink: z.string().nullable(),
})
export type WindowBootstrap = z.infer<typeof windowBootstrapSchema>
