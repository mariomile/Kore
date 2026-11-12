import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SavedCollectionView } from '@kore/core'
import { saveTagViews } from '@/lib/tags/tag-type-write'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'

/** Stable empty list, so a tag with no saved views never re-keys an effect. */
const EMPTY_SAVED_VIEWS: SavedCollectionView[] = []

/**
 * How long a burst of view edits (dragging a sort, typing a filter) settles
 * before it reaches the definition note: one write per gesture, not per
 * keystroke, so the vault's history and the index see one change.
 */
export const TYPE_VIEWS_WRITE_DELAY_MS = 600

/** Where a tag's saved views live and how to replace them. */
export interface SavedViewsStore {
  views: SavedCollectionView[]
  /** Replace the tag's whole tab list (order included). */
  persist: (views: SavedCollectionView[]) => void
}

/**
 * The saved views of one tag page (organization point 3). A type keeps them
 * in its definition note (`tags/<type>.md`, `views:`), so they follow the
 * vault to every device and to agents; `typeViews` is what the index read
 * from that note. An untyped tag (`typeViews === null`) has no note to hold
 * them and keeps them in local settings, as before. `undefined` means the
 * type is still loading: nothing is shown or written until it resolves.
 *
 * File writes are debounced, and the latest list is held in memory until the
 * index reports the note back, so the tabs never flicker to the old list in
 * between. A first visit to a type whose views still sit in local settings
 * moves them into the note, and drops the local copy once the note has them.
 */
export function useSavedViewsStore(
  tagKey: string | null,
  typeViews: readonly SavedCollectionView[] | null | undefined,
): SavedViewsStore {
  const { graph } = useGraph()
  const generation = graph?.generation
  const { settings, updateSettingsWith } = useSettings()
  const fileBacked = tagKey !== null && typeViews !== null && typeViews !== undefined

  const [pending, setPending] = useState<{
    tagKey: string
    views: SavedCollectionView[]
  } | null>(null)
  const queuedRef = useRef<{
    tagKey: string
    views: SavedCollectionView[]
    timer: ReturnType<typeof setTimeout>
  } | null>(null)
  const inFlightRef = useRef(0)

  const write = useCallback(
    (key: string, views: SavedCollectionView[]) => {
      if (generation === undefined) {
        return
      }
      inFlightRef.current += 1
      saveTagViews(key, views, generation)
        .catch((error: unknown) => {
          console.error('Could not save the views to the type file', error)
          setPending(null)
        })
        .finally(() => {
          inFlightRef.current -= 1
        })
    },
    [generation],
  )

  const flush = useCallback(() => {
    const queued = queuedRef.current
    if (queued === null) {
      return
    }
    clearTimeout(queued.timer)
    queuedRef.current = null
    write(queued.tagKey, queued.views)
  }, [write])

  // Leaving the tag (or the screen) writes whatever is still waiting.
  useEffect(() => flush, [tagKey, flush])

  // The index caught up with the note: what it holds is the truth again,
  // whether it is our write or an edit from another device.
  useEffect(() => {
    if (queuedRef.current === null && inFlightRef.current === 0) {
      setPending(null)
    }
  }, [typeViews])

  const fileViews = useMemo(
    () => (typeViews === null || typeViews === undefined ? EMPTY_SAVED_VIEWS : [...typeViews]),
    [typeViews],
  )
  const localViews =
    tagKey === null
      ? EMPTY_SAVED_VIEWS
      : (settings.collectionSavedViews?.[tagKey] ?? EMPTY_SAVED_VIEWS)
  // Until a type's first write lands, views saved on this device before
  // types kept their own still show (and are moved, below).
  const views = fileBacked
    ? pending?.tagKey === tagKey
      ? pending.views
      : fileViews.length === 0
        ? localViews
        : fileViews
    : typeViews === undefined
      ? EMPTY_SAVED_VIEWS
      : localViews

  const persistLocal = useCallback(
    (key: string, next: SavedCollectionView[]) => {
      updateSettingsWith((current) => {
        const nextViews = { ...(current.collectionSavedViews ?? {}) }
        if (next.length === 0) {
          delete nextViews[key]
        } else {
          nextViews[key] = next
        }
        return { collectionSavedViews: nextViews }
      })
    },
    [updateSettingsWith],
  )

  const persist = useCallback(
    (next: SavedCollectionView[]) => {
      if (tagKey === null || typeViews === undefined) {
        return
      }
      if (!fileBacked) {
        persistLocal(tagKey, next)
        return
      }
      setPending({ tagKey, views: next })
      if (queuedRef.current !== null) {
        clearTimeout(queuedRef.current.timer)
      }
      queuedRef.current = {
        tagKey,
        views: next,
        timer: setTimeout(flush, TYPE_VIEWS_WRITE_DELAY_MS),
      }
    },
    [tagKey, typeViews, fileBacked, persistLocal, flush],
  )

  // One-time move: views saved on this device before types kept their own
  // go into the type's note; the local copy is dropped once the note has them.
  const migratedRef = useRef(new Set<string>())
  useEffect(() => {
    if (!fileBacked || tagKey === null || localViews.length === 0) {
      return
    }
    if (fileViews.length > 0) {
      persistLocal(tagKey, [])
      return
    }
    if (!migratedRef.current.has(tagKey)) {
      migratedRef.current.add(tagKey)
      write(tagKey, localViews)
    }
  }, [fileBacked, tagKey, localViews, fileViews, write, persistLocal])

  return { views, persist }
}
