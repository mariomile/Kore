import { useEffect, useState } from 'react'
import { suggestWikiTargets, type WikiSuggestion } from '@kore/core'

/**
 * Notes whose title matches `query`, for a "pick a note" dialog; null while
 * the dialog is closed (nothing is searched). A stale answer never lands
 * over a newer query's.
 */
export function useWikiSuggestions(query: string | null, limit = 8): readonly WikiSuggestion[] {
  const [results, setResults] = useState<readonly WikiSuggestion[]>([])
  useEffect(() => {
    if (query === null) {
      return
    }
    let live = true
    suggestWikiTargets(query.trim(), limit).then(
      (found) => {
        if (live) {
          setResults(found)
        }
      },
      () => {
        if (live) {
          setResults([])
        }
      },
    )
    return () => {
      live = false
    }
  }, [limit, query])
  return results
}
