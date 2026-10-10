import type { ReactElement } from 'react'
import { Refresh } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useConnectors } from '@/hooks/use-connectors'
import { ConnectorRow } from './connector-row'
import { SettingsSection } from './section'

/**
 * The Connectors section: sources that sync into the graph as plain markdown
 * notes (Readwise highlights, Granola meetings). Tokens go to the OS
 * keychain; Kore syncs on launch, every 15 minutes and on return to the app.
 */
export function ConnectorsSection(): ReactElement {
  const { items, connect, disconnect, setEnabled, setFolder, syncNow } = useConnectors()
  const anyEnabled = items.some((item) => item.connected === true && item.settings.enabled)
  const running = items.some((item) => item.running)

  return (
    <SettingsSection id="connectors">
      {items.map((item) => (
        <ConnectorRow
          key={item.connector.id}
          view={item}
          onConnect={connect}
          onDisconnect={disconnect}
          onEnabledChange={setEnabled}
          onFolderChange={setFolder}
        />
      ))}
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <p className="text-xs text-text-muted">
          New items arrive as notes on launch, every 15 minutes, and when you return to Kore. Kore
          only adds: notes you edit are never overwritten.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!anyEnabled || running}
          onClick={syncNow}
        >
          <Refresh aria-hidden />
          Sync now
        </Button>
      </div>
    </SettingsSection>
  )
}
