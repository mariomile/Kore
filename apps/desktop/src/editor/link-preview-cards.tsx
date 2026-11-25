import { useMemo, type ReactElement } from 'react'
import { definePlugin } from '@prosekit/core'
import { loadLinkPreview } from '@kore/core'
import { useExtension } from '@meowdown/react'
import { createLinkCardPlugin, deliverLinkPreview } from './link-card-plugin'
import { useOpenCardLink } from './use-open-card-link'

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
  const open = useOpenCardLink()
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
          open,
        }),
      ),
    [open],
  )

  useExtension(extension)
  return null
}
