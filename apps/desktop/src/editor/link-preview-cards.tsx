import { useEffect, useMemo, useRef, type ReactElement } from 'react'
import { definePlugin } from '@prosekit/core'
import { loadLinkPreview } from '@reflect/core'
import { useExtension } from '@meowdown/react'
import { openExternalUrl, preferOsBrowser } from '@/editor/open-external-link'
import { useSettings } from '@/providers/settings-provider'
import { createLinkCardPlugin, deliverLinkPreview } from './link-card-plugin'

interface LinkPreviewCardsProps {
  /**
   * Whether this note's links may be fetched. A preview is an outbound
   * request to the linked host, so a `private: true` note previews nothing —
   * the caller resolves that flag and fails closed while it is unknown.
   */
  enabled: boolean
}

/**
 * Render a line that holds nothing but a pasted URL as a preview card: an X
 * post as the post (author, words, counts), a LinkedIn post with its mark,
 * any other page as its title, description, image and favicon. The file
 * keeps a plain markdown link; `link-card-plugin` draws the card as a
 * decoration and core fetches the copy. Mounted as a NoteEditor child.
 */
export function LinkPreviewCards({ enabled }: LinkPreviewCardsProps): ReactElement | null {
  return enabled ? <LinkCards /> : null
}

function LinkCards(): null {
  const openLinksInApp = useSettings().settings.browserOpenLinksInApp
  const openLinksInAppRef = useRef(openLinksInApp)
  useEffect(() => {
    openLinksInAppRef.current = openLinksInApp
  }, [openLinksInApp])

  const extension = useMemo(
    () =>
      definePlugin(
        createLinkCardPlugin({
          // Core holds one promise per URL for the session (failures too), so
          // asking again on every edit is a map lookup, never a refetch.
          request: (url, view) => {
            void loadLinkPreview(url).then((preview) => {
              // A view torn down meanwhile drops the answer (deliver checks).
              if (preview !== null) {
                deliverLinkPreview(view, preview)
              }
            })
          },
          open: (url, event) => {
            openExternalUrl(url, {
              osBrowser: preferOsBrowser(event.altKey, openLinksInAppRef.current),
            })
          },
        }),
      ),
    [],
  )

  useExtension(extension)
  return null
}
