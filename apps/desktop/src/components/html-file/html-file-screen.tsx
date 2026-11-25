import { useState, type ReactElement } from 'react'
import { htmlDisplayName, htmlPageUrl } from '@kore/core'
import { TextAssetView } from '@/components/asset-viewer-views'
import { ExternalLink, Lock, Share } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAssetPersistence } from '@/editor/use-asset-persistence'
import { useHtmlTitle } from '@/hooks/use-html-title'
import { isMobileSurface } from '@/lib/platform-surface'
import { cn } from '@/lib/utils'
import { MobileScreenHeader } from '@/mobile/screen-header'
import { useBarHeightVar } from '@/mobile/use-bar-height'
import { useGraph } from '@/providers/graph-provider'
import { useRouter } from '@/routing/router'
import { useShareableFile } from './use-shareable-file'

interface HtmlFileScreenProps {
  /** Graph-relative path of the `.html` file. */
  path: string
}

type HtmlFileView = 'page' | 'code'

/** What both screens show of one page. */
interface HtmlPage {
  path: string
  generation: number | null
  /** The page's asset URL, null without an open vault. */
  url: string | null
  /** Its own title, else a name made from the file's. */
  title: string
  fileName: string
}

const PILL_CLASS =
  'flex h-7 items-center gap-1.5 rounded-full bg-surface-hover px-3 text-[13px] font-medium text-text-secondary transition-colors hover:text-text disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:text-text-muted'

/**
 * An HTML file from the vault as a page of its own, the way a PDF reads: the
 * page renders whole, scripts included, in a frame the `kore-asset`
 * protocol sandboxes (an opaque origin with no requests of its own and no
 * way into the app). The page is named by its own title and offers its
 * source, and the system's browser (Mac) or share sheet (iPhone).
 */
export function HtmlFileScreen({ path }: HtmlFileScreenProps): ReactElement {
  const { graph } = useGraph()
  const generation = graph?.generation ?? null
  const url = generation === null ? null : htmlPageUrl(generation, path)
  const title = useHtmlTitle(url) ?? htmlDisplayName(path)
  const fileName = path.split('/').at(-1) ?? path
  const page: HtmlPage = { path, generation, url, title, fileName }
  return isMobileSurface() ? (
    <MobileHtmlFileScreen page={page} />
  ) : (
    <DesktopHtmlFileScreen page={page} />
  )
}

function DesktopHtmlFileScreen({ page }: { page: HtmlPage }): ReactElement {
  const [view, setView] = useState<HtmlFileView>('page')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={page.title} description={page.path}>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="flex items-center gap-1 text-xs text-text-muted">
                <Lock aria-hidden className="size-3.5" />
                Sandboxed
              </span>
            }
          />
          <TooltipContent>
            Its scripts run apart from Kore: they can’t read your notes or post data anywhere.
          </TooltipContent>
        </Tooltip>
        <ViewToggle view={view} onChange={setView} />
        <OpenInBrowserButton path={page.path} generation={page.generation} />
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col pr-7 pb-6 pl-12">
        <PageBody page={page} view={view} className="rounded-xl border border-border shadow-sm" />
      </div>
    </div>
  )
}

/**
 * The phone's page: a pushed screen like a note's, with the stack's back
 * chevron and title bar, the share sheet at its end, and the page full width.
 */
function MobileHtmlFileScreen({ page }: { page: HtmlPage }): ReactElement {
  const [view, setView] = useState<HtmlFileView>('page')
  const { navigate, back, canBack } = useRouter()
  const { scopeRef, barRef } = useBarHeightVar('--mobile-header-height')
  return (
    <div ref={scopeRef} className="relative flex h-full w-screen flex-col">
      <MobileScreenHeader
        ref={barRef}
        title={page.title}
        onBack={() => (canBack ? back() : navigate({ kind: 'allNotes', filter: { kind: 'all' } }))}
        trailing={<ShareFileButton url={page.url} fileName={page.fileName} />}
      />
      <main
        className="relative flex min-h-0 flex-1 flex-col"
        style={{ paddingTop: 'var(--mobile-header-height, 0px)' }}
      >
        <div className="flex justify-center py-2">
          <ViewToggle view={view} onChange={setView} />
        </div>
        {/* A frame keeps its touches to itself: this strip leaves the
            screen's leading edge to the stack's back swipe. */}
        <div aria-hidden className="absolute inset-y-0 left-0 z-10 w-6" />
        <PageBody page={page} view={view} />
      </main>
    </div>
  )
}

function ViewToggle({
  view,
  onChange,
}: {
  view: HtmlFileView
  onChange: (view: HtmlFileView) => void
}): ReactElement {
  return (
    <div
      role="group"
      aria-label="Show"
      className="flex items-center gap-0.5 rounded-full bg-surface-hover p-0.5"
    >
      {(['page', 'code'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={view === mode}
          onClick={() => {
            onChange(mode)
          }}
          className={cn(
            'flex h-6 items-center rounded-full px-2.5 text-[13px] font-medium transition-colors',
            view === mode
              ? 'bg-surface text-text shadow-sm'
              : 'text-text-muted hover:text-text-secondary',
          )}
        >
          {mode === 'page' ? 'Page' : 'Code'}
        </button>
      ))}
    </div>
  )
}

/** The page itself, or its source. */
function PageBody({
  page,
  view,
  className,
}: {
  page: HtmlPage
  view: HtmlFileView
  className?: string
}): ReactElement {
  if (page.url === null) {
    return (
      <p className="flex flex-1 items-center justify-center text-sm text-text-muted">
        This page can’t be displayed here.
      </p>
    )
  }
  if (view === 'code') {
    return <TextAssetView url={page.url} />
  }
  return (
    <iframe
      title={page.title}
      src={page.url}
      // The protocol's CSP sandboxes the page too; the attribute keeps
      // the frame sandboxed even where a response lost its header.
      sandbox="allow-scripts"
      className={cn('min-h-0 w-full flex-1 bg-white', className)}
    />
  )
}

function OpenInBrowserButton({
  path,
  generation,
}: {
  path: string
  generation: number | null
}): ReactElement {
  const { openAsset } = useAssetPersistence(generation)
  return (
    <button
      type="button"
      onClick={() => {
        void openAsset(path)
      }}
      className={PILL_CLASS}
    >
      <ExternalLink aria-hidden />
      Open in browser
    </button>
  )
}

/** The share sheet, from the header's trailing slot: a round icon button. */
function ShareFileButton({
  url,
  fileName,
}: {
  url: string | null
  fileName: string
}): ReactElement {
  const file = useShareableFile(url, fileName, 'text/html')
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-11 rounded-full"
      aria-label="Share"
      disabled={file === null}
      onClick={() => {
        if (file !== null) {
          void navigator.share({ files: [file], title: fileName }).catch(() => undefined)
        }
      }}
    >
      <Share />
    </Button>
  )
}
