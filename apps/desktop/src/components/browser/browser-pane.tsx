import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  browserEmbedBack,
  browserEmbedBounds,
  browserEmbedClose,
  browserEmbedForward,
  browserEmbedNavigate,
  browserEmbedReload,
  browserEmbedShow,
  errorMessage,
  subscribeBrowserNavigated,
  type BrowserEmbedRect,
  type BrowserSearchEngine,
} from '@reflect/core'
import { ArrowLeft, ArrowRight, ExternalLink, Refresh } from '@/components/icons'
import {
  browserSessionUrl,
  setBrowserSessionUrl,
  subscribeBrowserSession,
} from '@/lib/browser-session'
import { openUrlSync } from '@/lib/open-url'
import { isNativeShell } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'

const SEARCH_URLS = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
} as const satisfies Record<BrowserSearchEngine, string>

/** Turn address-bar text into a navigable web URL (or a search for it). */
export function normalizeAddress(
  raw: string,
  engine: BrowserSearchEngine = 'duckduckgo',
): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return null
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }
  // Any other explicit scheme is not a web page — the pane refuses it, the
  // same policy the shell enforces.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return null
  }
  if (!/\s/.test(trimmed) && trimmed.includes('.')) {
    return `https://${trimmed}`
  }
  return `${SEARCH_URLS[engine]}${encodeURIComponent(trimmed)}`
}

/**
 * The mounted panes, oldest first — the last entry owns the (single)
 * embedded webview. The browser tab and the context rail's panel can be
 * mounted at once: when the owner unmounts, the webview is handed back to
 * the survivor (re-docked over its host) instead of being closed under it.
 */
interface BrowserHost {
  dock: () => void
}
const hostStack: BrowserHost[] = []

interface BrowserPaneProps {
  className?: string
}

/**
 * The built-in browser surface: an address bar over a host region that the
 * shell's embedded child webview covers (see `browser_embed_*`). Mount it in
 * a tab (the browser route) or the context rail — the page is one shared
 * session while either host is mounted. Its URL survives after the last host
 * closes, but the remote webview does not. Web harness and mobile have no
 * child webviews; they get an honest notice instead of a dead pane.
 */
export function BrowserPane({ className }: BrowserPaneProps): ReactElement {
  const { settings } = useSettings()
  const hostRef = useRef<HTMLDivElement>(null)
  const [address, setAddress] = useState(browserSessionUrl())
  const [error, setError] = useState<string | null>(
    isNativeShell() ? null : 'The built-in browser is available in the desktop app.',
  )
  // Follows the page: a link click or redirect rewrites the address bar
  // unless the user is mid-edit (the input is focused).
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isNativeShell()) {
      return
    }
    const host = hostRef.current
    if (host === null) {
      return
    }
    const rect = (): BrowserEmbedRect => {
      const bounds = host.getBoundingClientRect()
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    }
    const entry: BrowserHost = {
      dock: () => {
        void browserEmbedShow(browserSessionUrl(), rect()).catch((cause: unknown) => {
          setError(errorMessage(cause))
        })
      },
    }
    hostStack.push(entry)
    const replaceBounds = (): void => {
      // Only the owning host places the webview; a covered pane's observer
      // firing must not drag the page away from the owner.
      if (hostStack.at(-1) !== entry) {
        return
      }
      void browserEmbedBounds(rect()).catch(() => undefined)
    }
    entry.dock()

    const unsubscribeSession = subscribeBrowserSession((url) => {
      if (document.activeElement !== inputRef.current) {
        setAddress(url)
      }
    })
    const unlistenNavigated = subscribeBrowserNavigated((event) => {
      setBrowserSessionUrl(event.url)
    })
    const observer = new ResizeObserver(replaceBounds)
    observer.observe(host)
    window.addEventListener('resize', replaceBounds)

    return () => {
      window.removeEventListener('resize', replaceBounds)
      observer.disconnect()
      unsubscribeSession()
      void unlistenNavigated.then((unlisten) => {
        unlisten()
      })
      // The owner hands the webview to the surviving pane (tab closed while
      // the rail panel stays up → the panel re-docks it); with no survivor
      // it closes, releasing the remote page. A covered pane just leaves the
      // stack.
      const wasOwner = hostStack.at(-1) === entry
      const index = hostStack.indexOf(entry)
      if (index !== -1) {
        hostStack.splice(index, 1)
      }
      if (wasOwner) {
        const survivor = hostStack.at(-1)
        if (survivor !== undefined) {
          survivor.dock()
        } else {
          void browserEmbedClose().catch(() => undefined)
        }
      }
    }
  }, [])

  const navigate = (): void => {
    const url = normalizeAddress(address, settings.browserSearchEngine)
    if (url === null) {
      return
    }
    setAddress(url)
    setBrowserSessionUrl(url)
    void browserEmbedNavigate(url).catch((cause: unknown) => {
      setError(errorMessage(cause))
    })
  }

  if (error !== null) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center px-6 text-center text-sm text-text-muted',
          className,
        )}
      >
        {error}
      </div>
    )
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="flex flex-none items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          aria-label="Back"
          title="Back"
          onClick={() => {
            void browserEmbedBack().catch(() => undefined)
          }}
          className={toolbarButtonClass}
        >
          <ArrowLeft aria-hidden className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Forward"
          title="Forward"
          onClick={() => {
            void browserEmbedForward().catch(() => undefined)
          }}
          className={toolbarButtonClass}
        >
          <ArrowRight aria-hidden className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Reload"
          title="Reload"
          onClick={() => {
            void browserEmbedReload().catch(() => undefined)
          }}
          className={toolbarButtonClass}
        >
          <Refresh aria-hidden className="size-3.5" />
        </button>
        <input
          ref={inputRef}
          value={address}
          aria-label="Address"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => {
            setAddress(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              navigate()
              inputRef.current?.blur()
            }
          }}
          onBlur={() => {
            // Abandoned edits snap back to the page's real URL.
            setAddress(browserSessionUrl())
          }}
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-input-bg px-2.5 text-xs text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          placeholder="Search or enter address"
        />
        <button
          type="button"
          aria-label="Open in default browser"
          title="Open in default browser"
          onClick={() => {
            openUrlSync(browserSessionUrl())
          }}
          className={toolbarButtonClass}
        >
          <ExternalLink aria-hidden className="size-3.5" />
        </button>
      </div>
      {/* The embedded webview covers exactly this region. */}
      <div ref={hostRef} className="min-h-0 flex-1" data-testid="browser-embed-host" />
    </div>
  )
}

const toolbarButtonClass =
  'flex size-6 shrink-0 items-center justify-center rounded-md text-text-secondary transition-[color,background-color,transform] duration-150 ease-swift hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring active:scale-[0.97]'
