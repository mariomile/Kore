/**
 * How a graph's absolute root reads in the UI.
 *
 * The app's iCloud container directory is named after its container id, and
 * that id is permanent: `iCloud~app~lore`, from the `app.lore.*` Apple identity
 * this fork inherited and cannot rename without breaking every installed copy's
 * signing and sync (see AGENTS.md — Naming). Finder and the Files app hide it
 * behind the container's `NSUbiquitousContainerName` ("Kore"), but anything
 * that prints a real path — a terminal, a backup tool, and until now Kore's own
 * graph list — shows the raw directory and reads as a stray "Lore" folder.
 *
 * So the app spells its own paths the way the file managers do: the container
 * becomes `iCloud Drive › Kore`, plain iCloud Drive becomes `iCloud Drive`, and
 * a path under the home directory keeps the familiar `~` prefix.
 */

/** The app's iCloud container directory name — the container id, `.` → `~`. */
const CONTAINER_DIR = 'iCloud~app~lore'
/** Apple's own iCloud Drive container, where a user-placed graph lives. */
const CLOUD_DOCS_DIR = 'com~apple~CloudDocs'
/** The segment separator Finder and the Files app use in a location breadcrumb. */
const SEPARATOR = ' › '

const MOBILE_DOCUMENTS = '/Library/Mobile Documents/'

function breadcrumb(segments: readonly string[]): string {
  return segments.filter(Boolean).join(SEPARATOR)
}

/**
 * `root` rewritten for display. Returns the input unchanged when it is not a
 * path this knows how to shorten, so an arbitrary folder still shows in full.
 *
 * `home` is the user's home directory, when known; without it only the iCloud
 * rewrites apply.
 */
export function displayGraphPath(root: string, home?: string): string {
  const documents = root.indexOf(MOBILE_DOCUMENTS)
  if (documents !== -1) {
    const rest = root.slice(documents + MOBILE_DOCUMENTS.length).split('/')
    const [container, ...tail] = rest
    if (container === CONTAINER_DIR) {
      // The container's own `Documents/` is plumbing, not a place the user put
      // anything — Finder does not show it either.
      const inside = tail[0] === 'Documents' ? tail.slice(1) : tail
      return breadcrumb(['iCloud Drive', 'Kore', ...inside])
    }
    if (container === CLOUD_DOCS_DIR) {
      return breadcrumb(['iCloud Drive', ...tail])
    }
  }
  if (home !== undefined && home !== '') {
    const prefix = home.endsWith('/') ? home : `${home}/`
    if (root === home || root === prefix) {
      return '~'
    }
    if (root.startsWith(prefix)) {
      return `~/${root.slice(prefix.length)}`
    }
  }
  return root
}
