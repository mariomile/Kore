import { useState, type ReactElement } from 'react'
import { errorMessage, mcpClientSetup } from '@reflect/core'
import { Check, Copy } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { SettingsField } from './field'

interface AgentsMcpFieldProps {
  /** Absolute path of the bundled `reflect` CLI. */
  cliPath: string
  /** Absolute root of the open graph. */
  graphRoot: string
  graphName: string
}

type CopiedTarget = 'config' | 'command' | null

/**
 * Settings → Agents → MCP server: the copyable setup that lets Claude Desktop,
 * Claude Code, Cursor and other MCP clients use this graph through
 * `reflect mcp`. Nothing is written to any client's config; the user pastes it.
 */
export function AgentsMcpField({
  cliPath,
  graphRoot,
  graphName,
}: AgentsMcpFieldProps): ReactElement {
  const [readOnly, setReadOnly] = useState(false)
  const [copied, setCopied] = useState<CopiedTarget>(null)
  const [error, setError] = useState<string | null>(null)
  const setup = mcpClientSetup({ cliPath, graphRoot, readOnly })

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
      description={`Give Claude Desktop, Claude Code, Cursor or any MCP client tools to search, read and write “${graphName}”, its notes to attach, and daily, weekly and linking prompts. Private notes stay hidden.`}
    >
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
