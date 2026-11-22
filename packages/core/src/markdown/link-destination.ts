/**
 * A path or URL made safe as a Markdown link destination: the three
 * characters that end or split a `[label](destination)` (space, `(`, `)`)
 * percent-encoded, everything else left as written so the file name stays
 * readable in the source. The attachment resolvers decode it back.
 */
export function markdownLinkDestination(target: string): string {
  return target.replaceAll(' ', '%20').replaceAll('(', '%28').replaceAll(')', '%29')
}
