import { useLayoutEffect, type ReactElement } from 'react'
import { loadLinkPreview, type LinkPreview } from '@reflect/core'
import { useEditor } from '@meowdown/react'
import { whenEditorMounted } from './when-editor-mounted'

interface LinkPreviewCardsProps {
  /**
   * Whether this note's links may be fetched. A preview is an outbound
   * request to the linked host, so a `private: true` note previews nothing —
   * the caller resolves that flag and fails closed while it is unknown.
   */
  enabled: boolean
}

/**
 * The URL a line renders as a card, or `null` when the line is not one.
 *
 * Only a pasted link qualifies: an http(s) anchor whose text *is* its href and
 * whose paragraph holds nothing else. A named link (`[YC](url)`) keeps its
 * sentence, and a link with words around it stays inline — the card replaces a
 * URL nobody wanted to read, never prose.
 */
function cardUrl(anchor: HTMLElement): string | null {
  const href = anchor.getAttribute('href')
  if (href === null || !/^https?:\/\//i.test(href)) {
    return null
  }
  const text = anchor.textContent?.trim() ?? ''
  if (text !== href) {
    return null
  }
  const paragraph = anchor.closest('p')
  if (paragraph === null || (paragraph.textContent?.trim() ?? '') !== text) {
    return null
  }
  return href
}

/**
 * A `url()` value safe to inline in a stylesheet: `encodeURI` escapes the
 * quotes, parens and backslashes that could otherwise close the declaration.
 */
function cssImageValue(imageUrl: string): string {
  return `url("${encodeURI(imageUrl)}")`
}

/** Hand the card its copy. CSS draws it; nothing here builds DOM. */
function stamp(anchor: HTMLElement, preview: LinkPreview): void {
  anchor.setAttribute('data-link-card', preview.imageUrl === null ? 'text' : 'image')
  anchor.setAttribute('data-link-card-title', preview.title)
  anchor.setAttribute('data-link-card-site', preview.siteName)
  anchor.setAttribute('data-link-card-description', preview.description ?? '')
  if (preview.imageUrl === null) {
    anchor.style.removeProperty('--link-card-image')
  } else {
    anchor.style.setProperty('--link-card-image', cssImageValue(preview.imageUrl))
  }
}

/** Back to an ordinary link — the line changed, or the page said nothing. */
function clear(anchor: HTMLElement): void {
  if (!anchor.hasAttribute('data-link-card')) {
    return
  }
  anchor.removeAttribute('data-link-card')
  anchor.removeAttribute('data-link-card-title')
  anchor.removeAttribute('data-link-card-site')
  anchor.removeAttribute('data-link-card-description')
  anchor.style.removeProperty('--link-card-image')
}

/**
 * Render a line that holds nothing but a pasted URL as a preview card — the
 * page's title, its description, and its image, in place of the raw link.
 *
 * meowdown has no card node and the file keeps a plain markdown link, so this
 * follows the callout highlighter's shape: an observer over the editor's DOM
 * that stamps attributes for CSS (`styles/index.css`) and never touches the
 * document. Scraping the copy is core's job; the anchor's own text stays the
 * card's URL line, so the link is still selectable, editable and complete.
 *
 * Mounted as a NoteEditor child, so it lives for the editor session and
 * disconnects on unmount.
 */
export function LinkPreviewCards({ enabled }: LinkPreviewCardsProps): ReactElement | null {
  const editor = useEditor()

  useLayoutEffect(() => {
    if (!enabled) {
      return
    }
    // Resolved copy per URL for this editor session; `null` is "this page has
    // no card" (unreachable or untitled), which is as final as a hit — core
    // remembers the same outcome, so a re-decorate never re-asks.
    const resolved = new Map<string, LinkPreview | null>()
    const requested = new Set<string>()
    let disposed = false
    let observer: MutationObserver | null = null

    const decorate = (root: ParentNode): void => {
      for (const anchor of root.querySelectorAll<HTMLElement>('a.md-link')) {
        const url = cardUrl(anchor)
        if (url === null) {
          clear(anchor)
          continue
        }
        const preview = resolved.get(url)
        if (preview === undefined) {
          // The link stays plain until its page answers: a skeleton would
          // jump the line's height twice for a card that may never come.
          clear(anchor)
          if (!requested.has(url)) {
            requested.add(url)
            void loadLinkPreview(url).then((answer) => {
              if (disposed) {
                return
              }
              resolved.set(url, answer)
              if (answer !== null) {
                decorate(editor.view.dom)
              }
            })
          }
          continue
        }
        if (preview === null) {
          clear(anchor)
          continue
        }
        stamp(anchor, preview)
      }
    }

    const cancelMount = whenEditorMounted(editor, () => {
      const root = editor.view.dom
      decorate(root)
      // Attributes are deliberately not observed: the stamps above are our
      // own writes, and watching them would loop.
      observer = new MutationObserver(() => {
        decorate(root)
      })
      observer.observe(root, { subtree: true, childList: true, characterData: true })
    })
    return () => {
      disposed = true
      cancelMount()
      observer?.disconnect()
    }
  }, [editor, enabled])

  return null
}
