import { useMemo, useRef } from 'react'
import { useExtension } from '@meowdown/react'
import { definePlugin } from '@prosekit/core'
import { resolveExistingWikiTarget, subPagePreview } from '@kore/core'
import { readExistingNoteSource } from '@/lib/read-existing-note-source'
import { createPageCardPlugin, deliverPagePreview } from './page-card-plugin'

/**
 * Mounts sub-page cards in a NoteEditor. Previews come from the page itself
 * (the live buffer when it is open), so a card shows what the page says now.
 */
export function PageCards({
  generation,
  openPage,
}: {
  generation: number | null
  openPage: (target: string) => void
}): null {
  const live = useRef({ generation, openPage })
  live.current = { generation, openPage }

  useExtension(
    useMemo(
      () =>
        definePlugin(
          createPageCardPlugin({
            open: (target) => live.current.openPage(target),
            request: (target, view) => {
              const current = live.current.generation
              if (current === null) return
              deliverPagePreview(view, target, { title: target, excerpt: null, missing: false })
              void (async () => {
                try {
                  const resolution = await resolveExistingWikiTarget(target, current)
                  if (resolution.kind !== 'resolved') {
                    deliverPagePreview(view, target, {
                      title: target,
                      excerpt: null,
                      missing: true,
                    })
                    return
                  }
                  const source = await readExistingNoteSource(resolution.path, current)
                  deliverPagePreview(view, target, {
                    title: target,
                    excerpt: subPagePreview(source),
                    missing: false,
                  })
                } catch {
                  deliverPagePreview(view, target, { title: target, excerpt: null, missing: true })
                }
              })()
            },
          }),
        ),
      [],
    ),
  )
  return null
}
