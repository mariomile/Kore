import { z } from 'zod'

/** Mutually exclusive populations of the All Notes surface. */
export const noteListFilterSchema = z.discriminatedUnion('kind', [
  // `tag` narrows the unfiltered list in place (the All notes type chips);
  // unlike `kind: 'tag'` it stays on All notes rather than opening the tag's
  // own page.
  z.object({ kind: z.literal('all'), tag: z.string().optional() }),
  z.object({ kind: z.literal('inbox') }),
  z.object({ kind: z.literal('tag'), tag: z.string() }),
  // A vault folder's page: the notes filed under one graph-relative folder.
  z.object({ kind: z.literal('folder'), folder: z.string() }),
])

export type NoteListFilter = z.infer<typeof noteListFilterSchema>
