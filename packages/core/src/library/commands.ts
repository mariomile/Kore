import { z } from 'zod'
import { call } from '../ipc/invoke'

/**
 * The Library: coding agents' home folders (`~/.claude`, `~/.codex`,
 * `~/.agents`, …) read-only inside Kore. Rust fixes which folders exist and
 * fences every read to markdown inside them; nothing here writes.
 */

export const libraryRootSchema = z.object({
  id: z.string(),
  label: z.string(),
  path: z.string(),
})

export type LibraryRoot = z.infer<typeof libraryRootSchema>

export const libraryDirSchema = z.object({
  folders: z.array(z.string()),
  files: z.array(z.string()),
})

export type LibraryDir = z.infer<typeof libraryDirSchema>

/** The agent folders that exist on this machine. */
export async function libraryRoots(): Promise<LibraryRoot[]> {
  return await call('library_roots', {}, z.array(libraryRootSchema))
}

/** One level of a library folder; `dir` is relative to it, `''` for its top. */
export async function libraryList(root: string, dir: string): Promise<LibraryDir> {
  return await call('library_list', { root, dir }, libraryDirSchema)
}

/** One markdown file's text from a library folder. */
export async function libraryRead(root: string, path: string): Promise<string> {
  return await call('library_read', { root, path }, z.string())
}
