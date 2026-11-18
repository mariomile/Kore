import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clientsWithPinnedVault, mcpClientServers, mcpClientSetup } from '@kore/core'
import { InlineAlert } from '@/components/inline-alert'
import { Switch } from '@/components/ui/switch'
import { CopyButton } from './copy-button'
import { SettingsField } from './field'

interface AgentsMcpFieldProps {
  /** Absolute path of the bundled `kore` CLI. */
  cliPath: string
  graphName: string
}

const list = new Intl.ListFormat('en', { type: 'conjunction' })

/**
 * Settings → Agents → MCP server: the copyable setup that lets Claude Desktop,
 * Claude Code, Cursor and other MCP clients use the open vault through
 * `kore mcp`. The config names no vault path, so it follows the vault Kore
 * opened last and survives moving it; a client still holding an older config
 * tied to one folder is named, so the user can paste the new one. Nothing is
 * written to any client's config; the user pastes it.
 */
export function AgentsMcpField({ cliPath, graphName }: AgentsMcpFieldProps): ReactElement {
  const [readOnly, setReadOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setup = mcpClientSetup({ cliPath, readOnly })
  const { data: servers } = useQuery({
    queryKey: ['mcp-client-servers'],
    queryFn: mcpClientServers,
  })
  const pinned = servers === undefined ? [] : clientsWithPinnedVault(servers)

  return (
    <SettingsField
      legend="MCP server"
      description={`Give Claude Desktop, Claude Code, Cursor or any MCP client tools to search, read and write your notes, with daily, weekly and linking prompts. It serves the vault you opened last in Kore, now “${graphName}”, so it keeps working if you move or rename it. Private notes stay hidden.`}
    >
      {pinned.length > 0 ? (
        <InlineAlert className="mt-3">
          {`${list.format(pinned)} ${pinned.length === 1 ? 'uses' : 'use'} an older config tied to one folder, which stops working if the vault moves. Copy the config below and paste it there again.`}
        </InlineAlert>
      ) : null}
      <div className="mt-3 flex items-center gap-3">
        <Switch aria-label="Read-only" checked={readOnly} onCheckedChange={setReadOnly} />
        <span className="text-xs text-text-muted">Read-only (no tools that write)</span>
      </div>
      <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-surface-hover p-2 font-mono text-xs text-text-secondary select-text">
        {setup.configJson}
      </pre>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <CopyButton text={setup.configJson} label="Copy config" onError={setError} />
        <CopyButton
          text={setup.claudeCodeCommand}
          label="Copy Claude Code command"
          onError={setError}
        />
      </div>
      {error !== null ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </SettingsField>
  )
}
