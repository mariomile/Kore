import { useState, type ReactElement } from 'react'
import type { HtmlEmbed } from '@reflect/core'
import { Layers } from '@/components/icons'
import { Button } from '@/components/ui/button'

interface EmbeddedHtmlFrameProps {
  block: HtmlEmbed
}

/**
 * Raw markup in a frame that cannot reach the app: no `allow-same-origin`, so
 * scripts run in an opaque origin with no access to the app's DOM, storage or
 * cookies. The markup is served through `srcDoc` and held behind a click so a
 * widget that phones home does it only when the reader asks.
 */
export function EmbeddedHtmlFrame({ block }: EmbeddedHtmlFrameProps): ReactElement {
  const [loaded, setLoaded] = useState(false)

  if (!loaded) {
    return (
      <section className="mt-6 flex items-center gap-3 rounded-lg border border-border border-dashed px-3 py-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-text-muted">
          <Layers aria-hidden className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-2xs font-medium tracking-wide text-text-muted uppercase">
            HTML embed
          </span>
          <span className="block text-sm text-text-muted">
            Runs in a sandboxed frame. Nothing loads until you show it.
          </span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => setLoaded(true)}>
          Show
        </Button>
      </section>
    )
  }

  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-border">
      <iframe
        srcDoc={block.html}
        title="HTML embed"
        sandbox="allow-scripts allow-popups allow-forms"
        referrerPolicy="no-referrer"
        className="h-96 w-full bg-surface"
      />
    </div>
  )
}
