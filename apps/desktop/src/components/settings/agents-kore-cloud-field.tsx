import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { siCloudflare } from 'simple-icons'
import {
  activateKoreCloudForVault,
  errorMessage,
  forgetKoreCloud,
  koreCloudClient,
  koreCloudConnectorUrl,
  koreCloudTokenPageUrl,
  loadKoreCloud,
  uploadVaultToKoreCloud,
  type KoreCloudAgent,
  type KoreCloudUploadReport,
  type StoredKoreCloud,
} from '@kore/core'
import { Check } from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { loadKoreCloudWorker } from '@/lib/kore-cloud-bundle'
import { openUrlSync } from '@/lib/open-url'
import { providerFetch } from '@/lib/provider-fetch'
import { cn } from '@/lib/utils'
import { CopyButton } from './copy-button'
import { SettingsField } from './field'
import { BrandTile } from './provider-brands'

type Phase =
  | { kind: 'loading' }
  | { kind: 'off' }
  | { kind: 'token' }
  | { kind: 'working'; step: string; sent: number; total: number }
  | { kind: 'on' }

const count = new Intl.NumberFormat()

/** One line on what the last upload did, in the user's terms. */
export function uploadSummary(report: KoreCloudUploadReport): string {
  const parts = [
    report.uploaded === 0
      ? 'No new notes to upload'
      : `${count.format(report.uploaded)} ${report.uploaded === 1 ? 'note' : 'notes'} uploaded`,
  ]
  if (report.unchanged > 0) {
    parts.push(`${count.format(report.unchanged)} already there`)
  }
  if (report.private > 0) {
    parts.push(`${count.format(report.private)} private stayed on this Mac`)
  }
  if (report.differs.length > 0) {
    parts.push(
      `${count.format(report.differs.length)} changed in Kore Cloud, left as they are there`,
    )
  }
  if (report.tooLarge.length > 0) {
    parts.push(`${count.format(report.tooLarge.length)} over 1 MB stayed on this Mac`)
  }
  if (report.failed.length > 0) {
    parts.push(`${count.format(report.failed.length)} not uploaded`)
  }
  return `${parts.join(', ')}.`
}

/**
 * Settings → Agents → Always on → Kore Cloud (Plan 34): turn the vault into
 * a service in the user's own Cloudflare account, so Claude, ChatGPT and
 * other agents reach it with this Mac off. One button opens Cloudflare's
 * token page with the permissions filled in; the pasted token is used for
 * this run only and never stored. The Worker's address and the owner key go
 * to the keychain; once on, the field copies both, lists the agents that
 * connected and disconnects them, and sends notes added since.
 */
export function AgentsKoreCloudField({
  graphName,
  graphRoot,
  generation,
}: {
  graphName: string
  graphRoot: string
  generation: number
}): ReactElement {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [stored, setStored] = useState<StoredKoreCloud | null>(null)
  const [token, setToken] = useState('')
  const [report, setReport] = useState<KoreCloudUploadReport | null>(null)
  const [agents, setAgents] = useState<KoreCloudAgent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mine = stored !== null && stored.vaultRoot === graphRoot ? stored : null

  useEffect(() => {
    let current = true
    loadKoreCloud()
      .then((loaded) => {
        if (current) {
          setStored(loaded)
          setPhase({ kind: loaded !== null && loaded.vaultRoot === graphRoot ? 'on' : 'off' })
        }
      })
      .catch((caught: unknown) => {
        if (current) {
          setError(errorMessage(caught))
          setPhase({ kind: 'off' })
        }
      })
    return () => {
      current = false
    }
  }, [graphRoot])

  useEffect(() => {
    if (phase.kind !== 'on' || mine === null) {
      return
    }
    let current = true
    koreCloudClient(mine, providerFetch)
      .agents()
      .then((loaded) => {
        if (current) {
          setAgents(loaded)
        }
      })
      .catch(() => {
        // Not reachable right now (offline, still starting): the list just stays hidden.
        if (current) {
          setAgents(null)
        }
      })
    return () => {
      current = false
    }
  }, [phase.kind, mine])

  function openTokenPage(): void {
    openUrlSync(koreCloudTokenPageUrl())
  }

  function begin(): void {
    setError(null)
    setToken('')
    setPhase({ kind: 'token' })
    openTokenPage()
  }

  async function activate(): Promise<void> {
    setError(null)
    setPhase({ kind: 'working', step: 'Connecting to Cloudflare', sent: 0, total: 0 })
    try {
      const bundle = await loadKoreCloudWorker()
      const done = await activateKoreCloudForVault({
        token,
        fetch: providerFetch,
        bundle,
        vaultRoot: graphRoot,
        generation,
        onStep: (step) => setPhase({ kind: 'working', step, sent: 0, total: 0 }),
        onUpload: (sent, total) =>
          setPhase({ kind: 'working', step: 'Uploading notes', sent, total }),
      })
      setToken('')
      setReport(done.report)
      setStored(await loadKoreCloud())
      setPhase({ kind: 'on' })
    } catch (caught) {
      setError(errorMessage(caught))
      const saved = await loadKoreCloud().catch(() => null)
      setStored(saved)
      setPhase({ kind: saved !== null && saved.vaultRoot === graphRoot ? 'on' : 'token' })
    }
  }

  async function uploadNew(): Promise<void> {
    if (mine === null) {
      return
    }
    setError(null)
    setPhase({ kind: 'working', step: 'Reading your notes', sent: 0, total: 0 })
    try {
      setReport(
        await uploadVaultToKoreCloud(mine, providerFetch, generation, (sent, total) =>
          setPhase({ kind: 'working', step: 'Uploading notes', sent, total }),
        ),
      )
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPhase({ kind: 'on' })
    }
  }

  async function disconnect(agent: KoreCloudAgent): Promise<void> {
    if (mine === null) {
      return
    }
    setError(null)
    try {
      const cloud = koreCloudClient(mine, providerFetch)
      await cloud.revokeAgent(agent.id)
      setAgents(await cloud.agents())
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  async function forget(): Promise<void> {
    setError(null)
    try {
      await forgetKoreCloud()
      setStored(null)
      setAgents(null)
      setReport(null)
      setPhase({ kind: 'off' })
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  return (
    <SettingsField
      legend="Kore Cloud"
      description={`Keep “${graphName}” reachable by Claude, ChatGPT and other agents even when this Mac is off. It runs free in your own Cloudflare account, and Kore runs nothing. Private notes never leave this Mac.`}
    >
      <div className="mt-3 flex flex-col gap-2">
        {phase.kind === 'loading' ? <p className="text-xs text-text-muted">Checking…</p> : null}

        {phase.kind === 'off' ? (
          <>
            {stored !== null ? (
              <p className="text-xs text-text-muted">
                Kore Cloud on this Mac serves another vault ({stored.vaultRoot}). Setting it up here
                creates a separate one.
              </p>
            ) : null}
            <CloudflareRow note="Needs a free account.">
              <Button size="xs" onClick={begin}>
                Set up Kore Cloud
              </Button>
            </CloudflareRow>
          </>
        ) : null}

        {phase.kind === 'token' || phase.kind === 'working' ? (
          <CloudflareRow note="Your free account." />
        ) : null}

        {phase.kind === 'token' ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void activate()
            }}
          >
            <ol className="list-decimal pl-4 text-xs text-text-secondary">
              <li>
                On the Cloudflare page that opened, pick your account and press{' '}
                <span className="font-medium text-text">Create Token</span>. The permissions are
                already filled in.{' '}
                <button
                  type="button"
                  className="text-text underline underline-offset-2 hover:text-text-secondary"
                  onClick={openTokenPage}
                >
                  Open it again
                </button>
              </li>
              <li>Copy the token and paste it here. Kore uses it once and doesn’t keep it.</li>
            </ol>
            <div className="flex items-center gap-2">
              <Input
                type="password"
                aria-label="Cloudflare API token"
                placeholder="Cloudflare API token"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className="h-7 flex-1"
                autoFocus
              />
              <Button size="xs" type="submit" disabled={token.trim() === ''}>
                Continue
              </Button>
              <Button
                size="xs"
                variant="ghost"
                type="button"
                onClick={() => {
                  setToken('')
                  setError(null)
                  setPhase({ kind: mine !== null ? 'on' : 'off' })
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {phase.kind === 'working' ? (
          <div className="flex flex-col gap-2" aria-live="polite">
            <span className="inline-flex items-center gap-2 text-xs text-text-secondary">
              <Spinner />
              {phase.total > 0
                ? `Uploading notes: ${count.format(phase.sent)} of ${count.format(phase.total)}`
                : `${phase.step}…`}
            </span>
            {phase.total > 0 ? (
              <Progress
                aria-label="Notes uploaded"
                value={Math.round((phase.sent / phase.total) * 100)}
              />
            ) : null}
          </div>
        ) : null}

        {phase.kind === 'on' && mine !== null ? (
          <>
            <CloudflareRow note={koreCloudConnectorUrl(mine)} mono>
              <Badge variant="secondary">
                <Check aria-hidden />
                On
              </Badge>
            </CloudflareRow>
            {report !== null ? (
              <p className="text-xs text-text-muted">{uploadSummary(report)}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton
                variant="default"
                text={koreCloudConnectorUrl(mine)}
                label="Copy connector URL"
                onError={setError}
              />
              <CopyButton text={mine.ownerKey} label="Copy owner key" onError={setError} />
              <Button size="xs" variant="outline" onClick={() => void uploadNew()}>
                Upload new notes
              </Button>
            </div>
            <p className="text-xs text-text-muted">
              In Claude or ChatGPT, add a custom connector with the URL above. When Kore asks, name
              the agent, choose what it may do, and paste the owner key.
            </p>
            {agents !== null ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-text-secondary">Connected agents</span>
                {agents.length === 0 ? (
                  <p className="text-xs text-text-muted">None yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {agents.map((agent) => (
                      <li key={agent.id} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                          {agent.name}
                        </span>
                        <span className="text-xs text-text-muted">
                          {agent.access === 'read' ? 'Read-only' : 'Reads and writes'}
                        </span>
                        <Button
                          size="xs"
                          variant="ghost"
                          aria-label={`Disconnect ${agent.name}`}
                          onClick={() => void disconnect(agent)}
                        >
                          Disconnect
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
            {/* Ghost buttons pulled left by their own padding so their text lines up with the copy above. */}
            <div className="-ml-2 flex items-center gap-1">
              <Button size="xs" variant="ghost" onClick={begin}>
                Update service
              </Button>
              <Button size="xs" variant="ghost" onClick={() => void forget()}>
                Forget on this Mac
              </Button>
            </div>
          </>
        ) : null}

        {error !== null ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </SettingsField>
  )
}

/**
 * Where Kore Cloud runs: Cloudflare's mark in the same tile the other agent
 * rows use, a one-line note (the connector URL once it is on), and the
 * state's control on the right.
 */
function CloudflareRow({
  note,
  mono = false,
  children,
}: {
  note: string
  mono?: boolean
  children?: ReactNode
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <BrandTile path={siCloudflare.path} />
        <div className="flex min-w-0 flex-col">
          <span className="text-sm text-text">Cloudflare</span>
          <span
            className={cn('text-xs text-text-muted', mono && 'truncate font-mono select-text')}
            title={mono ? note : undefined}
          >
            {note}
          </span>
        </div>
      </div>
      {children !== undefined ? <div className="shrink-0">{children}</div> : null}
    </div>
  )
}
