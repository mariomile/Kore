import { useState, type ReactElement } from 'react'
import { ChevronLeft, ChevronRight } from '@/components/icons'
import { syncEveryLabel, useConnectors, type ConnectorView } from '@/hooks/use-connectors'
import { useSettings } from '@/providers/settings-provider'
import { ConnectorSection } from './connector-section'
import { ConnectedBadge, IntegrationLogo, type IntegrationLogoId } from './integration-card'
import { APPLE_DESCRIPTION, IntegrationsSection } from './integrations-section'
import type { SettingsSectionEntry } from './sections'

/** One tile of the overview: what it is and where it stands. */
interface IntegrationTile {
  id: IntegrationLogoId
  title: string
  description: string
  connected: boolean
  /** One line under the description: the frequency, "Off", "Not connected" … */
  state: string
}

function connectorTile(view: ConnectorView): IntegrationTile {
  const connected = view.connected === true
  return {
    id: view.connector.id,
    title: view.connector.label,
    description: view.connector.description,
    connected,
    state: !connected
      ? 'Not connected'
      : view.settings.enabled
        ? syncEveryLabel(view.settings.syncEvery)
        : 'Paused',
  }
}

/**
 * The Integrations page: an overview of every source as a tile with its mark
 * and state, and one source's settings when its tile is chosen, the way the
 * iPhone opens a source's sheet from the list.
 */
export function IntegrationsPage({
  sections,
}: {
  sections: readonly SettingsSectionEntry[]
}): ReactElement {
  const [selected, setSelected] = useState<IntegrationLogoId | null>(null)
  const connectors = useConnectors()
  const { settings } = useSettings()

  if (selected !== null) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="-ml-1.5 mb-4 flex items-center gap-0.5 rounded-md px-1.5 py-1 text-sm text-text-secondary transition-colors duration-100 hover:bg-surface-hover hover:text-text"
        >
          <ChevronLeft aria-hidden className="size-4" />
          All integrations
        </button>
        {selected === 'apple' ? <IntegrationsSection /> : <ConnectorSection id={selected} />}
      </div>
    )
  }

  const tiles = sections.flatMap((section): IntegrationTile[] => {
    if (section.id === 'apple') {
      return [
        {
          id: 'apple',
          title: section.title,
          description: APPLE_DESCRIPTION,
          connected: settings.contactsEnabled,
          state: settings.contactsEnabled ? 'Contacts on' : 'Off',
        },
      ]
    }
    const view = connectors.items.find((item) => item.connector.id === section.id)
    return view === undefined ? [] : [connectorTile(view)]
  })

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {tiles.map((tile) => (
        <button
          key={tile.id}
          type="button"
          onClick={() => setSelected(tile.id)}
          className="group flex flex-col rounded-lg border border-border bg-surface p-4 text-left shadow-sm transition-colors duration-100 hover:bg-surface-hover"
        >
          <div className="flex items-start justify-between gap-3">
            <IntegrationLogo id={tile.id} />
            {tile.connected ? <ConnectedBadge /> : null}
          </div>
          <div className="mt-3 text-[15px] font-semibold text-text">{tile.title}</div>
          <p className="mt-1 line-clamp-2 text-xs text-text-muted">{tile.description}</p>
          <div className="mt-4 flex items-center justify-between gap-2 text-xs text-text-secondary">
            <span className="truncate">{tile.state}</span>
            <ChevronRight
              aria-hidden
              className="size-4 shrink-0 text-text-muted transition-transform duration-150 group-hover:translate-x-0.5"
            />
          </div>
        </button>
      ))}
    </div>
  )
}
