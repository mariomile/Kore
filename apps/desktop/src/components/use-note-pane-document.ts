import { useState } from 'react'
import { isDaily, isTemplatePath, isUntitledNotePath, untitledNoteSeed } from '@reflect/core'
import { useNoteDocument, type NoteDocument } from '@/editor/use-note-document'
import { useDailyNoteSeed } from '@/hooks/use-daily-note-seed'

/** What `useNotePaneDocument` hands the pane. */
export interface NotePaneDocument {
  /** The Plan 05 document session driving this pane's editor. */
  document: NoteDocument
  /** Whether the pane's note is a daily note (date-titled). */
  dailyNote: boolean
}

/**
 * The pane's document session plus the seeding policy around it: which paths
 * may lazily create, which seed a missing note adopts (the name-me template
 * for untitled notes, `templates/daily.md` for dailies), and which notes
 * track renames.
 */
export function useNotePaneDocument(
  path: string,
  generation: number | null,
  lazy: boolean,
  dailyDate: string | undefined,
): NotePaneDocument {
  const dailyNote = isDaily(path)
  const lazyCreate = lazy && (dailyNote || isUntitledNotePath(path))
  // Templates rename via file operations only (settings, or outside the app):
  // the rename pipeline's slug targets live under `notes/`, so tracking a
  // template's title would move it out of `templates/`. The untitled `id:`
  // seed is skipped for the same reason — it exists to feed that pipeline.
  const template = isTemplatePath(path)
  // One seed per (pane, path): a fresh seed carries a fresh `id:`, and a mere
  // re-render must not mint a new identity (the session is keyed on the seed).
  // Re-mint during render when the path changes — only the committed render's
  // seed reaches the session, so the transient stale render is harmless, and
  // this avoids writing a ref during render.
  const needsSeed = lazyCreate && !dailyNote && !template
  const [seed, setSeed] = useState(() => ({ path, seed: untitledNoteSeed() }))
  if (needsSeed && seed.path !== path) {
    setSeed({ path, seed: untitledNoteSeed() })
  }
  // A daily's seed is `templates/daily.md`, not the name-me template: the date
  // already names it. Undefined when the graph has no daily template, which
  // leaves dailies opening empty exactly as they did before.
  const dailySeed = useDailyNoteSeed(dailyDate ?? null)
  // One value, one spread: `needsSeed` already excludes dailies, so the two
  // sources are mutually exclusive — computed here so the object below
  // doesn't ask the reader to prove it.
  const missingSeed = needsSeed ? seed.seed : lazyCreate && dailyNote ? dailySeed : undefined
  const document = useNoteDocument(path, generation, {
    createIfMissing: lazyCreate,
    // Every editable regular note maintains title-addressed links and
    // title-mirroring backlink displays. The coordinator separately limits
    // title-derived file moves to Reflect-managed notes.
    trackRenames: !dailyNote && !template,
    // A missing ordinary note opens as a name-me template (old Reflect's
    // new-note flow): the seed — `id:` frontmatter plus an empty H1 the
    // caret lands in, ghosted "Untitled" by the title placeholder — only
    // reaches disk if the user edits, and typing names the note. A missing
    // daily opens on `templates/daily.md` instead, under the same contract:
    // the seed is the clean baseline, so a day you look at and leave still
    // writes nothing.
    ...(missingSeed !== undefined ? { missingSeed } : {}),
  })
  return { document, dailyNote }
}
