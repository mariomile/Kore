import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clientsWithPinnedVault, errorMessage, mcpClientServers, mcpClientSetup } from '@kore/core'
import { Check, Copy } from '@/components/icons'
import { InlineAlert } from '@/components/inline-alert'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { SettingsField } from './field'

interface AgentsMcpFieldProps {
  /** Absolute path of the bundled `kore` CLI. */
  cliPath: string
  graphName: string
}

type CopiedTarget = 'config' | 'command' | null

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
  const [copied, setCopied] = useState<CopiedTarget>(null)
  const [error, setError] = useState<string | null>(null)
  const setup = mcpClientSetup({ cliPath, readOnly })
  const { data: servers } = useQuery({
    queryKey: ['mcp-client-servers'],
    queryFn: mcpClientServers,
  })
  const pinned = servers === undefined ? [] : clientsWithPinnedVault(servers)

  async function copy(target: Exclude<CopiedTarget, null>, text: string): Promise<void> {
    setError(null)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(target)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

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
        <Switch
          aria-label="Read-only"
          checked={readOnly}
          onCheckedChange={(checked) => {
            setReadOnly(checked)
            setCopied(null)
          }}
        />
        <span className="text-xs text-text-muted">Read-only (no tools that write)</span>
      </div>
      <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-surface-hover p-2 font-mono text-xs text-text-secondary select-text">
        {setup.configJson}
      </pre>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="xs" variant="outline" onClick={() => void copy('config', setup.configJson)}>
          {copied === 'config' ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied === 'config' ? 'Copied' : 'Copy config'}
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => void copy('command', setup.claudeCodeCommand)}
        >
          {copied === 'command' ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied === 'command' ? 'Copied' : 'Copy Claude Code command'}
        </Button>
      </div>
      {error !== null ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </SettingsField>
  )
}
