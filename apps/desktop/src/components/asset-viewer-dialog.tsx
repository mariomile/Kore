import type { ReactElement } from 'react'
import { ExternalLink } from '@/components/icons'
import { CsvAssetView, DocxAssetView, TextAssetView } from '@/components/asset-viewer-views'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { isMobileSurface } from '@/lib/platform-surface'

/** What the in-app viewer can render; anything else keeps the OS-open path. */
export type ViewableAssetKind = 'pdf' | 'csv' | 'docx' | 'text' | 'image'

/** The viewer kind for a graph-relative asset path, or null to open externally. */
export function viewableAssetKind(assetPath: string): ViewableAssetKind | null {
  if (/\.pdf$/i.test(assetPath)) {
    return 'pdf'
  }
  if (/\.[ct]sv$/i.test(assetPath)) {
    return 'csv'
  }
  if (/\.docx$/i.test(assetPath)) {
    return 'docx'
  }
  if (/\.(?:txt|markdown|md|log|json)$/i.test(assetPath)) {
    return 'text'
  }
  // HEIC stays with the OS: the webviews Kore runs in can't all draw it.
  if (/\.(?:avif|bmp|gif|jpe?g|png|webp)$/i.test(assetPath)) {
    return 'image'
  }
  return null
}

/**
 * Whether opening `assetPath` shows the in-app viewer. A PDF on the mobile app
 * does not: the viewer frames it, and a WebKit frame on iOS draws only the
 * first page at its natural size with no zoom, so the system's own preview
 * (every page, pinch zoom, share) is the one that reads it.
 */
export function opensInAssetViewer(assetPath: string): boolean {
  const kind = viewableAssetKind(assetPath)
  return kind !== null && !(kind === 'pdf' && isMobileSurface())
}

interface AssetViewerDialogProps {
  /** Graph-relative path of the attachment being viewed (drives the title). */
  assetPath: string
  /** The `kore-asset://` URL to render, or null when unresolvable. */
  url: string | null
  onClose: () => void
  /** Hand the file to the OS viewer instead (the pre-viewer behavior). */
  onOpenExternally: () => void
}

/**
 * The in-app attachment viewer: a large dialog rendering the asset off the
 * graph's `kore-asset://` protocol instead of bouncing to an external
 * app. PDFs use the webview's native renderer; converted DOCX renders in a
 * fully sandboxed iframe (`sandbox=""`); HTML pages open as a screen of their
 * own (`HtmlFileScreen`); CSV/TSV renders as a table, plain text as a scroller and an image whole. "Open externally"
 * keeps the old path one click away — including for platforms whose webview
 * can't render PDFs inline.
 */
export function AssetViewerDialog({
  assetPath,
  url,
  onClose,
  onOpenExternally,
}: AssetViewerDialogProps): ReactElement {
  const kind = viewableAssetKind(assetPath)
  const fileName = assetPath.split('/').pop() ?? assetPath

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose()
      }}
    >
      <DialogContent className="flex h-[85vh] w-[min(64rem,92vw)] flex-col gap-3 p-4">
        <DialogHeader className="flex-none">
          <div className="flex items-center gap-3 pr-8">
            <DialogTitle className="min-w-0 truncate text-sm font-semibold">{fileName}</DialogTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenExternally}
              className="ml-auto shrink-0"
            >
              <ExternalLink aria-hidden className="size-3.5" />
              Open externally
            </Button>
          </div>
        </DialogHeader>

        {url === null ? (
          <p className="flex flex-1 items-center justify-center text-sm text-text-muted">
            This attachment can’t be displayed here — try opening it externally.
          </p>
        ) : kind === 'csv' ? (
          <CsvAssetView url={url} />
        ) : kind === 'docx' ? (
          <DocxAssetView url={url} />
        ) : kind === 'text' ? (
          <TextAssetView url={url} />
        ) : kind === 'image' ? (
          <img
            src={url}
            alt={fileName}
            draggable={false}
            className="min-h-0 w-full flex-1 rounded-lg object-contain"
          />
        ) : (
          <iframe
            title={fileName}
            src={url}
            // Unsandboxed on purpose: the webview's built-in PDF plugin does
            // not run inside a sandboxed frame.
            className="min-h-0 w-full flex-1 rounded-lg border border-border bg-surface"
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
