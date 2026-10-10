import { useId, useState, type ReactElement } from 'react'
import { errorMessage, type ConnectorId } from '@reflect/core'
import { ExternalLink } from '@/components/icons'
import { InlineAlert } from '@/components/inline-alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { connectorStatusText, type ConnectorView } from '@/hooks/use-connectors'
import { openUrlSync } from '@/lib/open-url'

interface ConnectorRowProps {
  view: ConnectorView
  onConnect: (id: ConnectorId, token: string, importHistory: boolean) => Promise<void>
  onDisconnect: (id: ConnectorId) => Promise<void>
  onEnabledChange: (id: ConnectorId, enabled: boolean) => void
  onFolderChange: (id: ConnectorId, folder: string) => string | null
}

/**
 * One connector in the Connectors settings card: the credential form while
 * disconnected; the on/off switch, destination folder and sync status once
 * connected.
 */
export function ConnectorRow({
  view,
  onConnect,
  onDisconnect,
  onEnabledChange,
  onFolderChange,
}: ConnectorRowProps): ReactElement {
  const { connector, settings } = view
  const labelId = useId()
  const [token, setToken] = useState('')
  const [importHistory, setImportHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [folderDraft, setFolderDraft] = useState<string | null>(null)
  const folder = settings.folder ?? connector.defaultFolder

  async function connect(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await onConnect(connector.id, token, importHistory)
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
    const problem = onFolderChange(connector.id, folderDraft)
    setError(problem)
    if (problem === null) {
      setFolderDraft(null)
    }
  }

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div id={labelId} className="text-sm font-medium text-text">
            {connector.label}
          </div>
          <p className="mt-0.5 text-xs text-text-muted">
            {view.connected === true ? connectorStatusText(view) : connector.description}
          </p>
        </div>
        {view.connected === true ? (
          <Switch
            aria-labelledby={labelId}
            checked={settings.enabled}
            onCheckedChange={(checked) => onEnabledChange(connector.id, checked)}
            className="shrink-0"
          />
        ) : null}
      </div>
      {view.connected === false ? (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
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
            className="min-w-48 flex-1 font-mono text-xs"
          />
          <Button type="submit" size="sm" disabled={busy || token.trim() === ''}>
            {busy ? 'Checking…' : 'Connect'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => openUrlSync(connector.tokenUrl)}
          >
            Get {connector.tokenLabel.toLowerCase()}
            <ExternalLink aria-hidden />
          </Button>
          <label className="flex w-full cursor-pointer items-center gap-1.5 text-xs text-text-secondary">
            <Checkbox
              checked={importHistory}
              onCheckedChange={(next) => setImportHistory(next === true)}
            />
            Also import items from before today (leave off if another app already wrote them into
            this graph)
          </label>
        </form>
      ) : null}
      {view.connected === true ? (
        <div className="mt-3 flex items-center gap-2">
          <label className="text-xs text-text-muted" htmlFor={`${labelId}-folder`}>
            Folder
          </label>
          <Input
            id={`${labelId}-folder`}
            value={folderDraft ?? folder}
            onChange={(event) => setFolderDraft(event.target.value)}
            onBlur={commitFolder}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitFolder()
              }
            }}
            placeholder="Graph root"
            className="flex-1 text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-text-muted hover:text-destructive"
            onClick={() => void onDisconnect(connector.id)}
          >
            Disconnect
          </Button>
        </div>
      ) : null}
      {error !== null ? (
        <div className="mt-3">
          <InlineAlert tone="warning">{error}</InlineAlert>
        </div>
      ) : null}
    </div>
  )
}
