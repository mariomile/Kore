import { useEffect, useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { errorMessage, icloudAdoptGraph, icloudStatus } from '@reflect/core'
import { Cloud } from '@/components/icons'
import { InlineAlert } from '@/components/inline-alert'
import { ConnectGithubDialog } from '@/components/settings/connect-github-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { suggestRepoName } from '@/lib/github-repos'
import { adoptGraphToIcloud } from '@/lib/icloud-adopt'
import { isICloudRoot } from '@/lib/icloud-controller'
import { ICLOUD_STATUS_QUERY_KEY } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'
import { useSync } from '@/providers/sync-provider'

/**
 * Shown after the user picks a local Markdown folder that is not already in
 * iCloud Drive. iCloud copies the notes into the app container (the iPhone
 * path); GitHub keeps the folder where it is and syncs through a repository.
 * Recents, iCloud creates, and already-connected Git remotes never trigger it.
 */
export function EnableLocalSyncDialog(): ReactElement | null {
  const { graph, pendingLocalSyncOffer, dismissLocalSyncOffer, openRecent } = useGraph()
  const { backup, disconnectGraph } = useSync()
  const [githubOpen, setGithubOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bridgeReady = useBridgeReady()
  const { data: icloud } = useQuery({
    queryKey: ICLOUD_STATUS_QUERY_KEY,
    queryFn: icloudStatus,
    enabled: bridgeReady && pendingLocalSyncOffer,
  })

  useEffect(() => {
    if (pendingLocalSyncOffer && backup.phase === 'connected') {
      dismissLocalSyncOffer()
    }
  }, [backup.phase, dismissLocalSyncOffer, pendingLocalSyncOffer])

  if (!pendingLocalSyncOffer || graph === null || isICloudRoot(graph.root)) {
    return null
  }

  // The GitHub wizard starts the backup controller (`loading`) before it
  // finishes connecting — keep it mounted through that, or the sheet vanishes
  // mid-flow. Auto-dismiss on `connected` still ends the offer after success.
  if (githubOpen) {
    return (
      <ConnectGithubDialog
        suggestedRepoName={suggestRepoName(graph.name)}
        onClose={() => setGithubOpen(false)}
      />
    )
  }

  if (backup.phase === 'loading' || backup.phase === 'connected') {
    return null
  }

  const icloudPending = bridgeReady && icloud === undefined
  const icloudAvailable = icloud?.available === true

  async function enableIcloud(): Promise<void> {
    if (graph === null) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await adoptGraphToIcloud({
        generation: graph.generation,
        backupConnected: false,
        adopt: icloudAdoptGraph,
        disconnectGraph,
        openRecent,
      })
      if (result.opened) {
        dismissLocalSyncOffer()
        return
      }
      if (result.warning !== null) {
        setError(result.warning)
      }
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy) {
          dismissLocalSyncOffer()
        }
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sync this folder across devices?</DialogTitle>
          <DialogDescription>
            You opened a local Markdown folder. Enable sync so the same notes appear on your iPhone
            and other devices.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {icloudPending ? (
            <p className="text-xs text-text-muted">Checking iCloud…</p>
          ) : icloudAvailable ? (
            <div className="space-y-1.5">
              <Button className="w-full" disabled={busy} onClick={() => void enableIcloud()}>
                {busy ? <Spinner /> : <Cloud aria-hidden />}
                {busy ? 'Copying to iCloud…' : 'Enable iCloud sync'}
              </Button>
              <p className="text-xs leading-5 text-text-muted">
                Copies these notes into iCloud Drive. This folder stays on disk as a recovery copy.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Button
              className="w-full"
              variant={icloudAvailable ? 'outline' : 'default'}
              disabled={busy}
              onClick={() => setGithubOpen(true)}
            >
              Connect GitHub…
            </Button>
            <p className="text-xs leading-5 text-text-muted">
              Keeps this folder where it is. Syncs through a GitHub repository the iPhone app can
              pull.
            </p>
          </div>

          <Button
            variant="ghost"
            className="w-full"
            disabled={busy}
            onClick={dismissLocalSyncOffer}
          >
            Keep this folder as-is
          </Button>
          <p className="-mt-2 text-center text-xs text-text-muted">
            You can enable sync later in Settings.
          </p>

          {error !== null ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
