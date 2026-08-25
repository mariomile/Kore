import { useState, type ReactElement } from 'react'
import {
  createAgentProfile,
  errorMessage,
  isCliAgentProvider,
  type AgentProfile,
} from '@reflect/core'
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
import { toast } from '@/components/ui/toast'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'

/** Display names for provider kinds a profile can pin. */
const PROVIDER_LABELS: Record<string, string> = {
  'claude-cli': 'Claude Code',
  'codex-cli': 'Codex',
  'grok-cli': 'Grok',
  'cursor-cli': 'Cursor',
  hermes: 'Hermes',
}

export function providerLabel(kind: string): string {
  return PROVIDER_LABELS[kind] ?? kind
}

interface NewAgentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (profile: AgentProfile) => void
}

/** Name + optional provider pin → seeded soul and memory under agents/. */
export function NewAgentDialog({
  open,
  onOpenChange,
  onCreated,
}: NewAgentDialogProps): ReactElement {
  const { graph } = useGraph()
  const { settings } = useSettings()
  const [name, setName] = useState('')
  const [provider, setProvider] = useState('none')
  const [busy, setBusy] = useState(false)
  const generation = graph?.generation ?? null

  const cliProviders = settings.aiProviders.filter((entry) => isCliAgentProvider(entry.provider))

  const create = async (): Promise<void> => {
    if (generation === null || name.trim() === '') {
      return
    }
    setBusy(true)
    try {
      const profile = await createAgentProfile({
        name,
        provider: provider === 'none' ? null : provider,
        generation,
      })
      setName('')
      setProvider('none')
      onOpenChange(false)
      onCreated(profile)
    } catch (cause: unknown) {
      toast.add({ type: 'error', title: errorMessage(cause) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-96">
        <DialogHeader>
          <DialogTitle>New agent</DialogTitle>
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
            placeholder="Name — e.g. Riley, Research, Coach…"
            aria-label="Agent name"
            autoFocus
          />
          <Select
            value={provider}
            onValueChange={(value) => {
              setProvider(value ?? 'none')
            }}
          >
            <SelectTrigger aria-label="Agent provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Chat’s current model</SelectItem>
              {cliProviders.map((entry) => (
                <SelectItem key={entry.id} value={entry.provider}>
                  {providerLabel(entry.provider)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-text-muted">
            Creates <code>agents/&lt;slug&gt;/soul.md</code> (its identity — opens for editing) and{' '}
            <code>memory.md</code>. The provider pin also steers chat when you activate the agent.
          </p>
          <Button type="submit" disabled={busy || name.trim() === ''}>
            {busy ? 'Creating…' : 'Create agent'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
