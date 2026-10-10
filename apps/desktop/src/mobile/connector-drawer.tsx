import { useState, type ReactElement } from 'react'
import { errorMessage } from '@reflect/core'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerBody, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  connectorStatusText,
  type ConnectorView,
  type UseConnectorsResult,
} from '@/hooks/use-connectors'
import { openUrlSync } from '@/lib/open-url'

interface ConnectorDrawerProps {
  /** The connector shown; kept after close so the exit animation has content. */
  view: ConnectorView | null
  open: boolean
  onOpenChange: (open: boolean) => void
  actions: UseConnectorsResult
}

/** The mobile sheet for one connector: connect, folder, sync, disconnect. */
export function ConnectorDrawer({
  view,
  open,
  onOpenChange,
  actions,
}: ConnectorDrawerProps): ReactElement {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-label={view?.connector.label ?? 'Connector'}>
        {view !== null ? (
          <ConnectorSheet key={view.connector.id} view={view} actions={actions} />
        ) : null}
      </DrawerContent>
    </Drawer>
  )
}

function ConnectorSheet({
  view,
  actions,
}: {
  view: ConnectorView
  actions: UseConnectorsResult
}): ReactElement {
  const { connector, settings } = view
  const [token, setToken] = useState('')
  const [importHistory, setImportHistory] = useState(false)
  const [folderDraft, setFolderDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await actions.connect(connector.id, token, importHistory)
      setToken('')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  function commitFolder(): void {
    if (folderDraft === null) {
      return
    }
    const problem = actions.setFolder(connector.id, folderDraft)
    setError(problem)
    if (problem === null) {
      setFolderDraft(null)
    }
  }

  return (
    <>
      <DrawerTitle>{connector.label}</DrawerTitle>
      <DrawerBody>
        <p className="text-sm text-text-muted">{connector.description}</p>
        {view.connected === true ? (
          <>
            <label className="flex items-center justify-between gap-3 text-[15px]">
              <span>Sync</span>
              <Switch
                checked={settings.enabled}
                onCheckedChange={(checked) => actions.setEnabled(connector.id, checked)}
              />
            </label>
            <p className="text-sm text-text-muted">{connectorStatusText(view)}</p>
            <Input
              aria-label="Folder"
              value={folderDraft ?? settings.folder ?? connector.defaultFolder}
              onChange={(event) => setFolderDraft(event.target.value)}
              onBlur={commitFolder}
              placeholder="Graph root"
            />
            <div className="flex justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                onClick={() => void actions.disconnect(connector.id)}
              >
                Disconnect
              </Button>
              <Button
                type="button"
                disabled={!settings.enabled || view.running}
                onClick={actions.syncNow}
              >
                Sync now
              </Button>
            </div>
          </>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void connect()
            }}
          >
            <Input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={connector.tokenLabel}
              aria-label={`${connector.label} ${connector.tokenLabel}`}
              autoComplete="off"
            />
            <label className="flex items-center justify-between gap-3 text-[15px]">
              <span>Import past items</span>
              <Switch checked={importHistory} onCheckedChange={setImportHistory} />
            </label>
            <p className="text-sm text-text-muted">
              Leave off if another app already wrote them into this graph.
            </p>
            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => openUrlSync(connector.tokenUrl)}>
                Get {connector.tokenLabel.toLowerCase()}
              </Button>
              <Button type="submit" disabled={busy || token.trim() === ''}>
                {busy ? 'Checking…' : 'Connect'}
              </Button>
            </div>
          </form>
        )}
        {error !== null ? <p className="text-sm text-destructive">{error}</p> : null}
      </DrawerBody>
    </>
  )
}
