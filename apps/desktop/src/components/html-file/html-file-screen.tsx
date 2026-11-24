import { useState, type ReactElement } from 'react'
import { htmlDisplayName, htmlPageUrl } from '@kore/core'
import { TextAssetView } from '@/components/asset-viewer-views'
import { ExternalLink, Lock, Share } from '@/components/icons'
import { PageHeader } from '@/components/ui/page-header'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAssetPersistence } from '@/editor/use-asset-persistence'
import { useHtmlTitle } from '@/hooks/use-html-title'
import { isMobileSurface } from '@/lib/platform-surface'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'
import { useShareableFile } from './use-shareable-file'

interface HtmlFileScreenProps {
  /** Graph-relative path of the `.html` file. */
  path: string
}

type HtmlFileView = 'page' | 'code'

const PILL_CLASS =
  'flex h-7 items-center gap-1.5 rounded-full bg-surface-hover px-3 text-[13px] font-medium text-text-secondary transition-colors hover:text-text disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:text-text-muted'

/**
 * An HTML file from the vault as a page of its own, the way a PDF reads: the
 * page renders whole, scripts included, in a frame the `kore-asset`
 * protocol sandboxes (an opaque origin with no requests of its own and no
 * way into the app). The header names it by its own title and offers its source,
 * and the system's browser (Mac) or share sheet (iPhone).
 */
export function HtmlFileScreen({ path }: HtmlFileScreenProps): ReactElement {
  const { graph } = useGraph()
  const generation = graph?.generation ?? null
  const url = generation === null ? null : htmlPageUrl(generation, path)
  const title = useHtmlTitle(url)
  const fileName = path.split('/').at(-1) ?? path
  const [view, setView] = useState<HtmlFileView>('page')
  const mobile = isMobileSurface()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={title ?? htmlDisplayName(path)}
        // The phone keeps the page tall: a narrow gutter and no path line.
        {...(mobile ? { className: 'px-5 py-3' } : { description: path })}
      >
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
                setView(mode)
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
        {mobile ? (
          <ShareFileButton url={url} fileName={fileName} />
        ) : (
          <OpenInBrowserButton path={path} generation={generation} />
        )}
      </PageHeader>
      <div className={cn('flex min-h-0 flex-1 flex-col', !mobile && 'pr-7 pb-6 pl-12')}>
        {url === null ? (
          <p className="flex flex-1 items-center justify-center text-sm text-text-muted">
            This page can’t be displayed here.
          </p>
        ) : view === 'code' ? (
          <TextAssetView url={url} />
        ) : (
          <iframe
            title={title ?? fileName}
            src={url}
            // The protocol's CSP sandboxes the page too; the attribute keeps
            // the frame sandboxed even where a response lost its header.
            sandbox="allow-scripts"
            className={cn(
              'min-h-0 w-full flex-1 bg-white',
              !mobile && 'rounded-xl border border-border shadow-sm',
            )}
          />
        )}
      </div>
    </div>
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

function ShareFileButton({
  url,
  fileName,
}: {
  url: string | null
  fileName: string
}): ReactElement {
  const file = useShareableFile(url, fileName, 'text/html')
  return (
    <button
      type="button"
      disabled={file === null}
      onClick={() => {
        if (file !== null) {
          void navigator.share({ files: [file], title: fileName }).catch(() => undefined)
        }
      }}
      className={PILL_CLASS}
    >
      <Share aria-hidden />
      Share
    </button>
  )
}
