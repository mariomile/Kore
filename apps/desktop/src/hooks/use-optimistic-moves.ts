import { useCallback, useState } from 'react'

/**
 * The optimistic-drop overlay shared by the collection board and calendar: a
 * dropped card moves at once through this map while the stored rows only
 * catch up after write → watcher → refetch. A fresh `entries` reference
 * (which then carries the written values) clears the overlay at render time,
 * so a stale move can never keep overriding a row's real value.
 */
export function useOptimisticMoves<Move>(entries: unknown): {
  moves: Map<string, Move>
  record: (path: string, move: Move) => void
} {
  const [moves, setMoves] = useState<Map<string, Move>>(new Map())
  const [movesFor, setMovesFor] = useState(entries)
  if (movesFor !== entries) {
    setMovesFor(entries)
    setMoves(new Map())
  }
  const record = useCallback((path: string, move: Move) => {
    setMoves((current) => new Map(current).set(path, move))
  }, [])
  return { moves, record }
}
