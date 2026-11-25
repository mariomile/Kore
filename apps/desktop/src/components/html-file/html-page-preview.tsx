import { useEffect, useState, type ReactElement } from 'react'
import { cn } from '@/lib/utils'

/** The width a page is laid out at before it shrinks into a card: a laptop window. */
const PAGE_WIDTH = 1024

/** How far from the screen a preview starts loading, and stays loaded. */
const LIVE_MARGIN = '400px'

const SCROLLER_SELECTOR = '[data-near-viewport-scroller]'

/**
 * An HTML page as its own card cover: the page itself, laid out at
 * {@link PAGE_WIDTH} and shrunk to the cover, scripts included (a chart is
 * drawn, a slide shows its first frame). It runs in the same sandbox as
 * the page screen (the `kore-asset` protocol's CSP plus the frame's own
 * `sandbox`), takes no input, and only lives while the card is within
 * {@link LIVE_MARGIN} of the screen: a folder of a hundred pages runs the
 * few in view, never all of them. Until the page has loaded, `fallback`
 * (the file's icon) holds the cover.
 */
export function HtmlPagePreview({
  url,
  fallback,
}: {
  url: string
  fallback: ReactElement
}): ReactElement {
  const [cover, setCover] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [live, setLive] = useState(false)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)

  useEffect(() => {
    if (cover === null) {
      return
    }
    const resize = new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        const { width, height } = entry.contentRect
        setSize((current) =>
          current.width === width && current.height === height ? current : { width, height },
        )
      }
    })
    resize.observe(cover)
    // Unlike the note previews (use-near-viewport.ts), a page is unmounted
    // again once it scrolls away: a live page keeps running its scripts.
    const near = new IntersectionObserver(
      ([entry]) => {
        const isNear = entry?.isIntersecting ?? false
        setLive(isNear)
        if (!isNear) {
          // A page mounted again loads again: the icon holds until it has.
          setLoadedUrl(null)
        }
      },
      { root: cover.closest(SCROLLER_SELECTOR), rootMargin: LIVE_MARGIN },
    )
    near.observe(cover)
    return () => {
      resize.disconnect()
      near.disconnect()
    }
  }, [cover])

  // One pixel over the cover, which clips it: a scaled page never leaves a
  // hairline of its frame showing at the edge.
  const scale = (size.width + 1) / PAGE_WIDTH
  const loaded = live && loadedUrl === url
  return (
    <div ref={setCover} className="relative size-full overflow-hidden">
      {loaded ? null : (
        <div className="absolute inset-0 flex items-center justify-center">{fallback}</div>
      )}
      {live && size.width > 0 ? (
        <iframe
          title=""
          src={url}
          // The protocol's CSP sandboxes the page too; the attribute keeps
          // the frame sandboxed even where a response lost its header.
          sandbox="allow-scripts"
          tabIndex={-1}
          loading="lazy"
          onLoad={() => {
            setLoadedUrl(url)
          }}
          style={{
            width: PAGE_WIDTH,
            // The cover's own aspect, at the page's width.
            height: (size.height + 1) / scale,
            transform: `scale(${scale})`,
          }}
          className={cn(
            'pointer-events-none absolute left-0 top-0 origin-top-left border-0 bg-white',
            'transition-opacity duration-150',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      ) : null}
    </div>
  )
}
