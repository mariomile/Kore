import { useState, type ReactElement } from 'react'
import type { ConnectorId } from '@kore/core'
import { syncEveryLabel, useConnectors } from '@/hooks/use-connectors'
import { ConnectorDrawer } from '@/mobile/connector-drawer'
import { SettingsGroup, SettingsNavRow } from '@/mobile/settings-list'

/** The mobile Settings group listing integrations (Granola, Readwise …). */
export function MobileConnectorsGroup(): ReactElement {
  const actions = useConnectors()
  const [selected, setSelected] = useState<ConnectorId | null>(null)
  const [open, setOpen] = useState(false)
  const selectedView = actions.items.find((item) => item.connector.id === selected) ?? null

  return (
    <>
      <SettingsGroup
        header="Integrations"
        footer="Meetings and highlights arrive as plain notes in your vault."
      >
        {actions.items.map((item) => (
          <SettingsNavRow
            key={item.connector.id}
            label={item.connector.label}
            value={
              item.connected !== true
                ? 'Not connected'
                : item.settings.enabled
                  ? syncEveryLabel(item.settings.syncEvery)
                  : 'Off'
            }
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
