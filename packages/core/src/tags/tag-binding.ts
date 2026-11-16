import { foldTag } from '../markdown'

/**
 * Which tag a type should bind to. A type is keyed by one tag, and its
 * members are the notes carrying that tag. Vaults that grew up in Obsidian
 * often nest their kinds (`type/project`, `type/person`), so a type created
 * as `#project` from the sidebar collects nothing while 165 notes sit on
 * `#type/project`. This finds that case: another tag ending in the same
 * name that more notes carry, which the type settings offer to switch to.
 */

/** A tag in use and how many notes carry it. */
export interface TagUse {
  tag: string
  count: number
}

/** The suggested tag for a type, with its note count. */
export interface TypeTagSuggestion {
  /** The tag notes actually use, display casing (`type/project`). */
  tag: string
  /** Folded key the definition would move to. */
  key: string
  count: number
}

function lastSegment(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1)
}

/** How many notes carry `tag` exactly, from the vault's tag counts. */
export function tagUseCount(tag: string, uses: readonly TagUse[]): number {
  const key = foldTag(tag)
  return uses.find((use) => foldTag(use.tag) === key)?.count ?? 0
}

/**
 * The tag `tag`'s type should rather bind to, or `null` when it already
 * binds to the best match. A candidate ends in the same last segment
 * (`project` ↔ `type/project`, `areas/project`), is carried by more notes
 * than `tag` itself, and is not itself defined as a type (`definedKeys`),
 * since moving onto an existing type would collide. The most used wins;
 * ties go to the shorter, then alphabetical tag, so the pick is stable.
 */
export function suggestTypeTag(
  tag: string,
  uses: readonly TagUse[],
  definedKeys: readonly string[],
): TypeTagSuggestion | null {
  const key = foldTag(tag)
  const name = lastSegment(key)
  const own = tagUseCount(key, uses)
  const defined = new Set(definedKeys.map(foldTag))
  let best: TypeTagSuggestion | null = null
  for (const use of uses) {
    const candidate = foldTag(use.tag)
    if (candidate === key || lastSegment(candidate) !== name || defined.has(candidate)) {
      continue
    }
    if (use.count <= own) {
      continue
    }
    const better =
      best === null ||
      use.count > best.count ||
      (use.count === best.count &&
        (candidate.length < best.key.length ||
          (candidate.length === best.key.length && candidate < best.key)))
    if (better) {
      best = { tag: use.tag, key: candidate, count: use.count }
    }
  }
  return best
}
