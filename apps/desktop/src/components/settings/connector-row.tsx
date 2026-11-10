import { useId, useState, type ReactElement } from 'react'
import { errorMessage, type ConnectorId } from '@reflect/core'
import { ExternalLink } from '@/components/icons'
import { InlineAlert } from '@/components/inline-alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  connectorStatusText,
  type ConnectorView,
  type UseConnectorsResult,
} from '@/hooks/use-connectors'
import { openUrlSync } from '@/lib/open-url'
import { useSettings } from '@/providers/settings-provider'
import { ConnectorLayoutFields } from './connector-layout-fields'

interface ConnectorRowProps {
  view: ConnectorView
  onConnect: (id: ConnectorId, token: string, importHistory: boolean) => Promise<void>
  onDisconnect: (id: ConnectorId) => Promise<void>
  onEnabledChange: (id: ConnectorId, enabled: boolean) => void
  /** Folder, file name pattern and tags. */
  layout: Pick<UseConnectorsResult, 'setFolder' | 'setPattern' | 'setTags'>
}

/**
 * One connector in the Connectors settings card: the credential form while
 * disconnected; the on/off switch, sync status, and where and how notes
 * land (folder, file name pattern, tags) once connected.
 */
export function ConnectorRow({
  view,
  onConnect,
  onDisconnect,
  onEnabledChange,
  layout,
}: ConnectorRowProps): ReactElement {
  const { connector, settings } = view
  const { settings: appSettings } = useSettings()
  const labelId = useId()
  const [token, setToken] = useState('')
  const [importHistory, setImportHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div id={labelId} className="text-sm font-medium text-text">
            {connector.label}
          </div>
          <p className="mt-0.5 text-xs text-text-muted">
            {view.connected === true
              ? connectorStatusText(view, appSettings)
              : connector.description}
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
            Get {connector.tokenNoun}
            <ExternalLink aria-hidden />
          </Button>
          <label className="flex w-full cursor-pointer items-center gap-1.5 text-xs text-text-secondary">
            <Checkbox
              checked={importHistory}
              onCheckedChange={(next) => setImportHistory(next === true)}
            />
            Also import items from before today (leave off if another app already wrote them into
            this vault)
          </label>
        </form>
      ) : null}
      {view.connected === true ? (
        <div className="mt-3 grid gap-2">
          <ConnectorLayoutFields view={view} actions={layout} onProblem={setError} />
          <div className="flex justify-end">
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
