/**
 * Whether a note body holds nothing but empty list markers: `-`, `- -`, an
 * indented `    -`, blank lines. That is what an editor leaves behind when a
 * note's seed bullet is touched (typed into and erased, Tab-indented) without
 * any real content landing, and it must count as empty for the lazy no-litter
 * contract: a daily note that does not exist yet stays uncreated. A thematic
 * break (`---`) and an empty task (`- [ ]`) are content, so they never count.
 */
export function isBlankListSkeleton(markdown: string): boolean {
  return markdown.split('\n').every((line) => BLANK_LIST_LINE.test(line))
}

/** Optional whitespace, then zero or more bare markers each followed by
 *  whitespace or the end of the line. `---` fails: its markers touch. */
const BLANK_LIST_LINE = /^\s*(?:[-*+](?:\s+|$))*$/
