import type { ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { agentSkillStatus, clientsWithPinnedVault, mcpClientServers } from '@kore/core'
import { InlineAlert } from '@/components/inline-alert'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { isMacosDesktop } from '@/lib/platform'

const list = new Intl.ListFormat('en', { type: 'conjunction' })

interface PinnedAgentsNoticeProps {
  /** Absolute root of the vault about to move. */
  root: string
  /** Read the agents' configs only while the move is being confirmed. */
  enabled: boolean
}

/**
 * Shown where the user confirms moving the vault: the agents still tied to
 * this exact folder (an MCP config copied before configs followed the vault,
 * or the installed vault skill). After the move they would keep working on
 * the copy left behind, so the notice says where to refresh them. Renders
 * nothing when no agent is tied to the folder.
 */
export function PinnedAgentsNotice({
  root,
  enabled,
}: PinnedAgentsNoticeProps): ReactElement | null {
  const bridgeReady = useBridgeReady()
  const active = enabled && bridgeReady && isMacosDesktop
  const { data: servers } = useQuery({
    queryKey: ['mcp-client-servers'],
    queryFn: mcpClientServers,
    enabled: active,
  })
  // Same key as Settings → Agents, so both read one cached status.
  const { data: skills } = useQuery({
    queryKey: ['agent-skill', root],
    queryFn: agentSkillStatus,
    enabled: active,
  })
  const clients = servers === undefined ? [] : clientsWithPinnedVault(servers, root)
  // The vault's own skill comes first and names this folder when current.
  const skillPinned = skills?.skills[0]?.installState === 'current'
  const names = skillPinned ? [...clients, 'the vault skill'] : clients
  if (!active || names.length === 0) {
    return null
  }
  const apps = clients.length === 1 ? 'that app' : 'each app'
  const fix =
    clients.length === 0
      ? 'After the move, update the skills in Settings → Agents.'
      : skillPinned
        ? `After the move, paste the MCP config from Settings → Agents into ${apps} again (the new one follows the vault) and update the skills there.`
        : `After the move, paste the MCP config from Settings → Agents into ${apps} again: the new one follows the vault.`
  const verb = names.length === 1 ? 'points' : 'point'
  return (
    <InlineAlert>
      {`${capitalize(list.format(names))} ${verb} to this folder and would keep using the copy left here. ${fix}`}
    </InlineAlert>
  )
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
