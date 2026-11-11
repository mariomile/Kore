import { useState, type ReactElement } from 'react'
import {
  errorMessage,
  remoteAccessSetupPrompt,
  remoteAccessToken,
  rotateRemoteAccessToken,
  type RemoteTunnel,
} from '@kore/core'
import { Check, Copy } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { openUrlSync } from '@/lib/open-url'
import { requestRemoteAccessRestart, useRemoteAccess } from '@/lib/remote-access-store'
import { useSettings } from '@/providers/settings-provider'
import { AgentsRemoteAgentsList } from './agents-remote-agents-list'
import { SettingsField } from './field'

type CopiedTarget = 'url' | 'token' | 'prompt' | null

function tunnelNote(tunnel: RemoteTunnel, localUrl: string): string | null {
  switch (tunnel.kind) {
    case 'on':
      return null
    case 'no-tailscale':
      return `Install Tailscale and sign in to reach it from outside this Mac. For now it runs only at ${localUrl}.`
    case 'needs-enable':
      return 'Funnel is off for your tailnet. Turn it on once, then try again.'
    case 'offline':
    case 'error':
      return tunnel.message
  }
}

/**
 * Settings → Agents → Remote access: one switch that runs `kore mcp --http`
 * for this graph and publishes it with Tailscale Funnel, so Claude on the
 * web and iPhone, ChatGPT, Grok and other cloud agents can use it. The token
 * and the agents' own keys live in the keychain; the user pastes one sentence
 * into an agent, which reads the server's `/setup.md` and connects itself.
 */
export function AgentsRemoteAccessField({ graphName }: { graphName: string }): ReactElement {
  const { settings, updateSettings } = useSettings()
  const { phase } = useRemoteAccess()
  const [copied, setCopied] = useState<CopiedTarget>(null)
  const [error, setError] = useState<string | null>(null)
  const enabled = settings.remoteAccessEnabled
  const state = phase.kind === 'on' ? phase.state : null
  const url = state === null ? null : (state.publicUrl ?? state.localUrl)

  async function copy(target: Exclude<CopiedTarget, null>, text: () => Promise<string>) {
    setError(null)
    try {
      await navigator.clipboard.writeText(await text())
      setCopied(target)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  async function newToken(): Promise<void> {
    setError(null)
    try {
      await rotateRemoteAccessToken()
      setCopied(null)
      requestRemoteAccessRestart()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const note = state === null ? null : tunnelNote(state.tunnel, state.localUrl)
  const live = state?.tunnel.kind === 'on'
  const enableUrl = state?.tunnel.kind === 'needs-enable' ? state.tunnel.enableUrl : null
  return (
    <SettingsField
      legend="Remote access"
      description={`Let Claude on the web and iPhone, ChatGPT, Grok and other cloud agents use “${graphName}” over the internet through Tailscale Funnel, behind a token. Works while Kore is open and this Mac is awake. Private notes stay hidden.`}
    >
      <div className="mt-3 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Switch
            aria-label="Remote access"
            checked={enabled}
            onCheckedChange={(checked) => {
              setCopied(null)
              updateSettings({ remoteAccessEnabled: checked })
            }}
          />
          <span className="text-xs text-text-secondary">
            {!enabled
              ? 'Off'
              : phase.kind === 'starting'
                ? 'Starting…'
                : live
                  ? 'On, reachable from the internet'
                  : phase.kind === 'on'
                    ? 'On, only on this Mac'
                    : phase.kind === 'error'
                      ? 'Not running'
                      : 'Off'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            aria-label="Block writes from remote agents"
            checked={settings.remoteAccessReadOnly}
            onCheckedChange={(checked) => updateSettings({ remoteAccessReadOnly: checked })}
          />
          <span className="text-xs text-text-muted">Read-only (agents can’t write)</span>
        </div>
        {enabled && phase.kind === 'error' ? (
          <p className="text-xs text-destructive">{phase.message}</p>
        ) : null}
        {enabled && note !== null ? <p className="text-xs text-text-muted">{note}</p> : null}
        {enabled && url !== null ? (
          <p className="truncate font-mono text-xs text-text-secondary select-text" title={url}>
            {url}
          </p>
        ) : null}
        {enabled ? (
          <div className="flex flex-wrap items-center gap-2">
            {url !== null ? (
              <Button
                size="xs"
                onClick={() => void copy('prompt', async () => remoteAccessSetupPrompt(url))}
              >
                {copied === 'prompt' ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied === 'prompt' ? 'Copied' : 'Copy setup prompt'}
              </Button>
            ) : null}
            {url !== null ? (
              <Button size="xs" variant="outline" onClick={() => void copy('url', async () => url)}>
                {copied === 'url' ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied === 'url' ? 'Copied' : 'Copy URL'}
              </Button>
            ) : null}
            <Button
              size="xs"
              variant="outline"
              onClick={() => void copy('token', remoteAccessToken)}
            >
              {copied === 'token' ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied === 'token' ? 'Copied' : 'Copy token'}
            </Button>
            {enableUrl !== null ? (
              <Button size="xs" onClick={() => openUrlSync(enableUrl)}>
                Turn on Funnel
              </Button>
            ) : null}
            {phase.kind === 'error' || (state !== null && !live) ? (
              <Button size="xs" variant="outline" onClick={requestRemoteAccessRestart}>
                Try again
              </Button>
            ) : null}
            <Button size="xs" variant="ghost" onClick={() => void newToken()}>
              New token
            </Button>
          </div>
        ) : null}
        {enabled && live ? (
          <p className="text-xs text-text-muted">
            Paste the setup prompt into any agent: it reads how to connect and asks you for a key.
            Give it its own key from the list below, or the token. A new token disconnects every
            agent that signed in with it.
          </p>
        ) : null}
        {enabled ? <AgentsRemoteAgentsList /> : null}
        {error !== null ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </SettingsField>
  )
}
