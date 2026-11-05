import { useEffect, useState, type ReactElement } from 'react'
import {
  addRemoteAgent,
  errorMessage,
  remoteAgents,
  removeRemoteAgent,
  type RemoteAgent,
} from '@reflect/core'
import { Check, Copy } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { requestRemoteAccessRestart } from '@/lib/remote-access-store'

/**
 * The named agents under Remote access: each one gets its own key, signs
 * what it remembers with its name, writes only when allowed, and is removed
 * without disconnecting the others. Keys live in the keychain.
 */
export function AgentsRemoteAgentsList(): ReactElement {
  const [agents, setAgents] = useState<RemoteAgent[]>([])
  const [name, setName] = useState('')
  const [write, setWrite] = useState(false)
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
              <span className="text-xs text-text-muted">
                {agent.write ? 'Read and write' : 'Read-only'}
              </span>
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
            await addRemoteAgent(name, write)
            setName('')
            setWrite(false)
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
        <Switch aria-label="Let this agent write" checked={write} onCheckedChange={setWrite} />
        <span className="text-xs text-text-muted">Write</span>
        <Button size="xs" type="submit" disabled={name.trim() === ''}>
          Add agent
        </Button>
      </form>
      {error !== null ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
