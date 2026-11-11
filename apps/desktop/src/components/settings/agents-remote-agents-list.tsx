import { useEffect, useState, type ReactElement } from 'react'
import {
  addRemoteAgent,
  errorMessage,
  REMOTE_AGENT_ACCESS,
  remoteAgents,
  removeRemoteAgent,
  setRemoteAgentAccess,
  type RemoteAgent,
  type RemoteAgentAccess,
} from '@kore/core'
import { Check, Copy } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { requestRemoteAccessRestart } from '@/lib/remote-access-store'

/** What each access level reads as. */
const ACCESS_LABEL: Record<RemoteAgentAccess, string> = {
  read: 'Read-only',
  propose: 'Proposes changes',
  write: 'Reads and writes',
}

const ACCESS_ITEMS = REMOTE_AGENT_ACCESS.map((value) => ({ value, label: ACCESS_LABEL[value] }))

/** A new agent proposes until you trust it with more (Plan 33, A2). */
const NEW_AGENT_ACCESS: RemoteAgentAccess = 'propose'

function AccessSelect({
  label,
  value,
  onChange,
}: {
  label: string
  value: RemoteAgentAccess
  onChange: (access: RemoteAgentAccess) => void
}): ReactElement {
  return (
    <Select
      value={value}
      items={ACCESS_ITEMS}
      onValueChange={(next) => {
        const access = REMOTE_AGENT_ACCESS.find((option) => option === next)
        if (access !== undefined) {
          onChange(access)
        }
      }}
    >
      <SelectTrigger size="sm" aria-label={label} className="w-40 min-w-0 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ACCESS_ITEMS.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * The named agents under Remote access: each one gets its own key, signs
 * what it remembers with its name, and reads only, proposes changes you
 * accept in Activity, or writes; its access can change without a new key,
 * and it is removed without disconnecting the others. Keys live in the
 * keychain.
 */
export function AgentsRemoteAgentsList(): ReactElement {
  const [agents, setAgents] = useState<RemoteAgent[]>([])
  const [name, setName] = useState('')
  const [access, setAccess] = useState<RemoteAgentAccess>(NEW_AGENT_ACCESS)
  const [copied, setCopied] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    remoteAgents()
      .then((loaded) => {
        if (current) {
          setAgents(loaded)
        }
      })
      .catch((caught: unknown) => {
        if (current) {
          setError(errorMessage(caught))
        }
      })
    return () => {
      current = false
    }
  }, [])

  async function change(step: () => Promise<unknown>): Promise<void> {
    setError(null)
    try {
      await step()
      setAgents(await remoteAgents())
      requestRemoteAccessRestart()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  async function copyKey(agent: RemoteAgent): Promise<void> {
    setError(null)
    try {
      await navigator.clipboard.writeText(agent.key)
      setCopied(agent.id)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-text-secondary">Agents with their own key</span>
      {agents.length === 0 ? (
        <p className="text-xs text-text-muted">
          None yet. Give each agent its own key to see its name on what it remembers and to remove
          it alone.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {agents.map((agent) => (
            <li key={agent.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                {agent.name}
              </span>
              <AccessSelect
                label={`What ${agent.name} may do`}
                value={agent.access}
                onChange={(next) => void change(() => setRemoteAgentAccess(agent.id, next))}
              />
              <Button size="xs" variant="outline" onClick={() => void copyKey(agent)}>
                {copied === agent.id ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied === agent.id ? 'Copied' : 'Copy key'}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                aria-label={`Remove ${agent.name}`}
                onClick={() => void change(() => removeRemoteAgent(agent.id))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void change(async () => {
            await addRemoteAgent(name, access)
            setName('')
            setAccess(NEW_AGENT_ACCESS)
          })
        }}
      >
        <Input
          aria-label="Agent name"
          placeholder="Agent name, e.g. Grok bot"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-7 flex-1"
        />
        <AccessSelect label="What the new agent may do" value={access} onChange={setAccess} />
        <Button size="xs" type="submit" disabled={name.trim() === ''}>
          Add agent
        </Button>
      </form>
      {error !== null ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
