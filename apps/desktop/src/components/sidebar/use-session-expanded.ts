import { useCallback, useState } from 'react'
import { z } from 'zod'

const expandedSchema = z.array(z.string()).catch([])

function readExpanded(storageKey: string): ReadonlySet<string> {
  const stored = window.sessionStorage.getItem(storageKey)
  if (stored === null) {
    return new Set()
  }
  try {
    return new Set(expandedSchema.parse(JSON.parse(stored)))
  } catch {
    return new Set()
  }
}

/**
 * A sidebar tree's expanded rows, remembered for the session under
 * `storageKey` — the same per-session policy as the shelves' open state.
 */
export function useSessionExpanded(
  storageKey: string,
): readonly [ReadonlySet<string>, (id: string) => void] {
  const [expanded, setExpanded] = useState(() => readExpanded(storageKey))
  const toggle = useCallback(
    (id: string): void => {
      setExpanded((current) => {
        const next = new Set(current)
        if (!next.delete(id)) {
          next.add(id)
        }
        window.sessionStorage.setItem(storageKey, JSON.stringify([...next]))
        return next
      })
    },
    [storageKey],
  )
  return [expanded, toggle]
}
