import { useState, type ReactElement } from 'react'
import { Plug, Trash2 } from 'lucide-react'
import { deleteSecret, errorMessage, mcpSecretName, setSecret, type McpServer } from '@reflect/core'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toast'
import { useSettings } from '@/providers/settings-provider'
import { SettingsField } from './field'
import { SettingsSection } from './section'

/** `MCP_NAME_RE`'s UI-side normalizer: what the user types becomes a slug. */
function toServerName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, '-')
    .replaceAll(/^[-_]+|[-_]+$/g, '')
}

/**
 * Settings → MCP servers: external tools for the in-app agents, configured
 * entirely here — the server's shape lives in settings, its tokens live in
 * the OS keychain (written on save, deleted with the server, never shown
 * back). Servers ride agent chat and automations only in edit mode.
 */
export function McpSection(): ReactElement {
  const { settings, updateSettingsWith } = useSettings()
  const [addOpen, setAddOpen] = useState(false)
  const servers = settings.mcpServers

  const patch = (id: string, change: Partial<McpServer>): void => {
    updateSettingsWith((current) => ({
      mcpServers: current.mcpServers.map((server) =>
        server.id === id ? { ...server, ...change } : server,
      ),
    }))
  }

  const remove = async (server: McpServer): Promise<void> => {
    for (const key of server.envKeys) {
      await deleteSecret(mcpSecretName(server.id, key)).catch(() => {
        // A missing keychain entry is already the state deletion wants.
      })
    }
    updateSettingsWith((current) => ({
      mcpServers: current.mcpServers.filter((entry) => entry.id !== server.id),
    }))
  }

  return (
    <SettingsSection id="mcp">
      <SettingsField
        legend="Servers"
        description="External tools for your agents (Model Context Protocol). Configuration lives here; tokens go straight to the OS keychain. Agents get these tools only in edit mode."
      >
        <ul className="mt-3 space-y-2">
          {servers.map((server) => (
            <li
              key={server.id}
              className="flex items-center gap-3 rounded-lg bg-surface-sunken p-3"
            >
              <Plug aria-hidden className="size-4 shrink-0 text-text-muted" />
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-text">{server.name}</span>
                <p className="truncate text-xs text-text-muted">
                  {server.transport.kind === 'stdio'
                    ? [server.transport.command, ...server.transport.args].join(' ')
                    : server.transport.url}
                  {server.envKeys.length > 0 ? ` · ${server.envKeys.join(', ')} in keychain` : ''}
                </p>
              </div>
              <Switch
                aria-label={`${server.name} enabled`}
                checked={server.enabled}
                onCheckedChange={(checked) => patch(server.id, { enabled: checked })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${server.name}`}
                className="text-text-muted hover:text-destructive"
                onClick={() => void remove(server)}
              >
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => setAddOpen(true)}
        >
          Add MCP server
        </Button>
      </SettingsField>
      <AddMcpServerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        existingNames={servers.map((server) => server.name)}
        onCreate={(server) => {
          updateSettingsWith((current) => ({ mcpServers: [...current.mcpServers, server] }))
          setAddOpen(false)
        }}
      />
    </SettingsSection>
  )
}

interface AddMcpServerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingNames: string[]
  onCreate: (server: McpServer) => void
}

/**
 * Name + transport + optional secret env vars. Secrets are written to the
 * keychain before the server lands in settings, so a saved server is never
 * missing its credentials.
 */
function AddMcpServerDialog({
  open,
  onOpenChange,
  existingNames,
  onCreate,
}: AddMcpServerDialogProps): ReactElement {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'stdio' | 'http'>('stdio')
  const [command, setCommand] = useState('')
  const [url, setUrl] = useState('')
  const [envDraft, setEnvDraft] = useState<{ key: string; value: string }[]>([
    { key: '', value: '' },
  ])
  const [busy, setBusy] = useState(false)

  const serverName = toServerName(name)
  const transportValid = kind === 'stdio' ? command.trim() !== '' : url.trim() !== ''
  const nameValid = serverName !== '' && !existingNames.includes(serverName)

  const create = async (): Promise<void> => {
    if (!nameValid || !transportValid) {
      return
    }
    setBusy(true)
    const id = crypto.randomUUID()
    const env = envDraft
      .map((entry) => ({ key: entry.key.trim(), value: entry.value }))
      .filter((entry) => entry.key !== '' && entry.value !== '')
    try {
      for (const entry of env) {
        await setSecret(mcpSecretName(id, entry.key), entry.value)
      }
      const parts = command.trim().split(/\s+/)
      onCreate({
        id,
        name: serverName,
        transport:
          kind === 'stdio'
            ? { kind, command: parts[0] ?? '', args: parts.slice(1) }
            : { kind, url: url.trim() },
        envKeys: env.map((entry) => entry.key),
        enabled: true,
      })
      setName('')
      setCommand('')
      setUrl('')
      setEnvDraft([{ key: '', value: '' }])
    } catch (cause: unknown) {
      toast.add({ type: 'error', title: errorMessage(cause) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[28rem]">
        <DialogHeader>
          <DialogTitle>Add MCP server</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name — e.g. github, linear…"
            aria-label="Server name"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <Select
              value={kind}
              onValueChange={(value) => {
                setKind(value === 'http' ? 'http' : 'stdio')
              }}
            >
              <SelectTrigger aria-label="Transport" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">Command</SelectItem>
                <SelectItem value="http">HTTP</SelectItem>
              </SelectContent>
            </Select>
            {kind === 'stdio' ? (
              <Input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="npx -y @modelcontextprotocol/server-github"
                aria-label="Server command"
                className="flex-1 font-mono text-xs"
              />
            ) : (
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/mcp"
                aria-label="Server URL"
                className="flex-1 font-mono text-xs"
              />
            )}
          </div>
          {envDraft.map((entry, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={entry.key}
                onChange={(event) => {
                  const next = [...envDraft]
                  next[index] = { key: event.target.value, value: entry.value }
                  setEnvDraft(next)
                }}
                placeholder="GITHUB_TOKEN"
                aria-label={`Env variable ${index + 1} name`}
                className="w-44 font-mono text-xs"
              />
              <Input
                type="password"
                value={entry.value}
                onChange={(event) => {
                  const next = [...envDraft]
                  next[index] = { key: entry.key, value: event.target.value }
                  if (index === envDraft.length - 1 && event.target.value !== '') {
                    next.push({ key: '', value: '' })
                  }
                  setEnvDraft(next)
                }}
                placeholder="Secret value → keychain"
                aria-label={`Env variable ${index + 1} value`}
                className="flex-1 font-mono text-xs"
              />
            </div>
          ))}
          <p className="text-xs text-text-muted">
            Secret values are stored only in the OS keychain and injected into the server’s
            environment when an agent runs. They are never written to settings, notes, or Git.
          </p>
          <Button type="submit" disabled={busy || !nameValid || !transportValid}>
            {busy ? 'Saving…' : 'Add server'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
