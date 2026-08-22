import type { ReactElement } from 'react'
import { ExternalLink } from '@/components/icons'
import { CsvAssetView, DocxAssetView, TextAssetView } from '@/components/asset-viewer-views'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** What the in-app viewer can render; anything else keeps the OS-open path. */
export type ViewableAssetKind = 'pdf' | 'html' | 'csv' | 'docx' | 'text'

/** The viewer kind for a graph-relative asset path, or null to open externally. */
export function viewableAssetKind(assetPath: string): ViewableAssetKind | null {
  if (/\.pdf$/i.test(assetPath)) {
    return 'pdf'
  }
  if (/\.html?$/i.test(assetPath)) {
    return 'html'
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
  return null
}

interface AssetViewerDialogProps {
  /** Graph-relative path of the attachment being viewed (drives the title). */
  assetPath: string
  /** The `reflect-asset://` URL to render, or null when unresolvable. */
  url: string | null
  onClose: () => void
  /** Hand the file to the OS viewer instead (the pre-viewer behavior). */
  onOpenExternally: () => void
}

/**
 * The in-app attachment viewer: a large dialog rendering the asset off the
 * graph's `reflect-asset://` protocol instead of bouncing to an external
 * app. PDFs use the webview's native renderer; HTML (and converted DOCX)
 * renders in a fully sandboxed iframe (no scripts, no same-origin, no forms
 * — `sandbox=""`), so a note attachment can never run code against the app;
 * CSV/TSV renders as a table and plain text as a scroller. "Open externally"
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
      <DialogContent className="flex h-[85vh] w-[min(64rem,92vw)] max-w-none flex-col gap-3 p-4 sm:max-w-none">
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
        ) : (
          <iframe
            title={fileName}
            src={url}
            // HTML attachments are untrusted note content: the empty sandbox
            // blocks scripts, same-origin access, forms, and popups outright.
            // PDFs skip the sandbox — the webview's built-in PDF plugin does
            // not run inside a sandboxed frame.
            {...(kind === 'html' ? { sandbox: '' } : {})}
            className="min-h-0 w-full flex-1 rounded-lg border border-border bg-surface"
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
