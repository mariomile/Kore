/**
 * Round-trip safety guard (Plan 05b). Markdown is the durable source of truth,
 * so before the save pipeline rewrites a note, the editor must be able to
 * reproduce it. meowdown owns the classifier; it is re-exported here so the
 * rest of the app keeps importing it from one place. A `lossy` result opens the
 * note protected (read-only) rather than letting a converter gap silently
 * rewrite the file.
 */
import { checkRoundTrip, docToMarkdown, markdownToDoc } from '@meowdown/core'
import type { ImportCanonicalizer } from '@reflect/core'

export { checkRoundTrip, type RoundTripFidelity } from '@meowdown/core'

/**
 * A note body as the editor would save it, for the Obsidian import (Plan 31):
 * a `normalizing` body is written the way its first save would write it, so
 * that save changes only what the user typed. Every other body is returned
 * as it is: `exact` already is canonical, and `lossy` must not be touched.
 * A canonical form that would itself change on the next save means the
 * rewrite moved structure (a list that stops nesting, say), so that body is
 * treated as `lossy` and kept as written.
 */
export const canonicalizeImportBody: ImportCanonicalizer = (body) => {
  const fidelity = checkRoundTrip(body)
  if (fidelity !== 'normalizing') {
    return { fidelity, canonical: body }
  }
  const canonical = docToMarkdown(markdownToDoc(body))
  return checkRoundTrip(canonical) === 'exact'
    ? { fidelity, canonical }
    : { fidelity: 'lossy', canonical: body }
}
