import { z } from 'zod'

/** Mutually exclusive populations of the All Notes surface. */
export const noteListFilterSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('inbox') }),
  z.object({ kind: z.literal('tag'), tag: z.string() }),
])

export type NoteListFilter = z.infer<typeof noteListFilterSchema>
