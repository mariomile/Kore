import { useState, type ReactElement } from 'react'
import type { ConnectorId } from '@reflect/core'
import { useConnectors } from '@/hooks/use-connectors'
import { ConnectorDrawer } from '@/mobile/connector-drawer'
import { SettingsGroup, SettingsNavRow } from '@/mobile/settings-list'

/** The mobile Settings group listing connectors (Readwise, Granola …). */
export function MobileConnectorsGroup(): ReactElement {
  const actions = useConnectors()
  const [selected, setSelected] = useState<ConnectorId | null>(null)
  const [open, setOpen] = useState(false)
  const selectedView = actions.items.find((item) => item.connector.id === selected) ?? null

  return (
    <>
      <SettingsGroup
        header="Connectors"
        footer="New items arrive as notes when Kore opens and every 15 minutes. Notes you edit are never overwritten."
      >
        {actions.items.map((item) => (
          <SettingsNavRow
            key={item.connector.id}
            label={item.connector.label}
            value={item.connected !== true ? 'Not connected' : item.settings.enabled ? 'On' : 'Off'}
            onPress={() => {
              setSelected(item.connector.id)
              setOpen(true)
            }}
          />
        ))}
      </SettingsGroup>
      <ConnectorDrawer view={selectedView} open={open} onOpenChange={setOpen} actions={actions} />
    </>
  )
}
