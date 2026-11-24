import { useCallback, useState, type ReactElement } from 'react'
import { AssetViewerDialog, opensInAssetViewer } from '@/components/asset-viewer-dialog'
import { fileScreenRoute } from '@/routing/file-screen-route'
import { useRouter } from '@/routing/router'

interface AssetOpenerOptions {
  /** The asset's `kore-asset://` URL for the in-app viewer (null when unresolvable). */
  resolveUrl: (assetPath: string) => string | null
  /** Hand the file to the OS (use-asset-persistence.ts's `openAsset`). */
  openExternally: (assetPath: string) => Promise<void>
}

interface AssetOpener {
  /** Open a vault file the way Kore opens it from a note or a card. */
  openAsset: (assetPath: string) => Promise<void>
  /** The in-app viewer while a file is open in it; render it once, anywhere. */
  viewer: ReactElement | null
}

/**
 * How a vault file opens, wherever it is opened from (a note's file chip, a
 * folder's file card): a `.base`, `.canvas` or HTML page as Kore's own
 * screen, a file the in-app viewer renders (PDF, CSV, DOCX, text, images) in that
 * viewer, anything else in the app the OS picks. The viewer's "Open
 * externally" keeps the OS path one click away.
 */
export function useAssetOpener({ resolveUrl, openExternally }: AssetOpenerOptions): AssetOpener {
  const [viewing, setViewing] = useState<string | null>(null)
  const { navigate } = useRouter()
  const openAsset = useCallback(
    async (assetPath: string): Promise<void> => {
      const screen = fileScreenRoute(assetPath)
      if (screen !== null) {
        navigate(screen)
        return
      }
      if (opensInAssetViewer(assetPath)) {
        setViewing(assetPath)
        return
      }
      await openExternally(assetPath)
    },
    [navigate, openExternally],
  )
  const viewer =
    viewing === null ? null : (
      <AssetViewerDialog
        assetPath={viewing}
        url={resolveUrl(viewing)}
        onClose={() => {
          setViewing(null)
        }}
        onOpenExternally={() => {
          void openExternally(viewing)
          setViewing(null)
        }}
      />
    )
  return { openAsset, viewer }
}
