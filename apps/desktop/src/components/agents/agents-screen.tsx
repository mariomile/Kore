import { useState, type ReactElement } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpenText, Bot, Trash2, TriangleAlert, UserRound } from 'lucide-react'
import {
  AGENT_PENDING_MEMORY_PATH,
  AGENT_SHARED_FACTS_PATH,
  AGENT_SHARED_LOG_PATH,
  AGENT_USER_MEMORY_PATH,
  createAgentProfile,
  deleteNote,
  ensureSharedMemoryNotes,
  ensureUserMemoryNote,
  errorMessage,
  isCliAgentProvider,
  listAgentProfiles,
  parsePendingMemory,
  readNote,
  scanMemoryContent,
  withoutPendingProposal,
  writeNote,
  type AgentProfile,
  type PendingMemoryProposal,
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
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'
import { useRouter } from '@/routing/router'
import { AgentRoutinesSection } from './agent-routines-section'

/** Display names for provider kinds a profile can pin. */
const PROVIDER_LABELS: Record<string, string> = {
  'claude-cli': 'Claude Code',
  'codex-cli': 'Codex',
  'grok-cli': 'Grok',
  'cursor-cli': 'Cursor',
  hermes: 'Hermes',
}

function providerLabel(kind: string): string {
  return PROVIDER_LABELS[kind] ?? kind
}

const PROFILES_QUERY_KEY = ['agent-profiles']
const PENDING_QUERY_KEY = ['agent-pending-memory']

/**
 * The Agents screen (Hermes-agent model): the shared "About you" profile the
 * agents keep about the user, plus one card per agent profile — each a
 * directory under `agents/` holding the profile's soul (identity and voice,
 * the user's file) and memory (the agent's own working notes). One profile
 * is active at a time; its soul and memories ride into every chat session.
 * Everything is plain markdown, so Soul/Memory open in the ordinary editor.
 */
export function AgentsScreen(): ReactElement {
  const { graph } = useGraph()
  const { settings, updateSettings } = useSettings()
  const { navigate } = useRouter()
  const queryClient = useQueryClient()
  const generation = graph?.generation ?? null
  const activeSlug = settings.activeAgentProfile

  const profiles = useQuery({
    queryKey: PROFILES_QUERY_KEY,
    queryFn: listAgentProfiles,
  })
  const [createOpen, setCreateOpen] = useState(false)

  const pending = useQuery({
    queryKey: PENDING_QUERY_KEY,
    queryFn: async (): Promise<PendingMemoryProposal[]> => {
      try {
        return parsePendingMemory(await readNote(AGENT_PENDING_MEMORY_PATH))
      } catch {
        return []
      }
    },
  })

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: PENDING_QUERY_KEY })
  }

  const openNote = (path: string): void => {
    navigate({ kind: 'note', path })
  }

  const openUserProfile = async (): Promise<void> => {
    if (generation === null) {
      return
    }
    try {
      await ensureUserMemoryNote(generation)
    } catch (cause: unknown) {
      toast.add({ type: 'error', title: errorMessage(cause) })
      return
    }
    openNote(AGENT_USER_MEMORY_PATH)
  }

  const activate = (profile: AgentProfile | null): void => {
    updateSettings({ activeAgentProfile: profile?.slug ?? null })
    // A pinned CLI provider also steers the chat model, when it is configured.
    if (profile?.provider != null) {
      const configured = settings.aiProviders.find((entry) => entry.provider === profile.provider)
      if (configured !== undefined && isCliAgentProvider(configured.provider)) {
        updateSettings({
          chatModelSelection: { configId: configured.id, modelId: profile.model ?? 'default' },
        })
      }
    }
  }

  const openSharedNote = async (path: string): Promise<void> => {
    if (generation === null) {
      return
    }
    try {
      await ensureSharedMemoryNotes(generation)
    } catch (cause: unknown) {
      toast.add({ type: 'error', title: errorMessage(cause) })
      return
    }
    openNote(path)
  }

  const resolvePending = async (
    proposal: PendingMemoryProposal,
    action: 'approve' | 'discard',
  ): Promise<void> => {
    if (generation === null) {
      return
    }
    try {
      if (action === 'approve') {
        const current = await readNote(proposal.target).catch(() => '')
        const base = current.trimEnd()
        const updated = base === '' ? `${proposal.body}\n` : `${base}\n${proposal.body}\n`
        await writeNote(proposal.target, updated, generation)
      }
      const source = await readNote(AGENT_PENDING_MEMORY_PATH)
      await writeNote(
        AGENT_PENDING_MEMORY_PATH,
        withoutPendingProposal(source, proposal.heading),
        generation,
      )
    } catch (cause: unknown) {
      toast.add({ type: 'error', title: errorMessage(cause) })
    }
    refresh()
  }

  const remove = async (profile: AgentProfile): Promise<void> => {
    if (generation === null) {
      return
    }
    try {
      await deleteNote(profile.soulPath, generation)
      await deleteNote(profile.memoryPath, generation).catch(() => {
        // A profile without a memory file is still fully deleted.
      })
    } catch (cause: unknown) {
      toast.add({ type: 'error', title: errorMessage(cause) })
    }
    if (activeSlug === profile.slug) {
      updateSettings({ activeAgentProfile: null })
    }
    refresh()
  }

  const list = profiles.data ?? []
  return (
    <div className="mx-auto w-full max-w-2xl">
      <header className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-text">Agents</h1>
        <Button type="button" size="sm" className="ml-auto" onClick={() => setCreateOpen(true)}>
          New agent
        </Button>
      </header>
      <p className="mt-1 text-sm text-text-secondary">
        Each agent is a folder under <code>agents/</code>: a soul (who it is — your file) and a
        memory (what it learns — its file). The active agent’s soul and memories ride into every
        chat.
      </p>

      <section className="mt-6 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-3">
          <UserRound aria-hidden strokeWidth={1.75} className="size-5 text-text-muted" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium text-text">About you</h2>
            <p className="text-xs text-text-muted">
              Shared by every agent: what they know about you, kept in{' '}
              <code>{AGENT_USER_MEMORY_PATH}</code>.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void openUserProfile()}>
            Open
          </Button>
        </div>
      </section>

      <section className="mt-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-3">
          <BookOpenText aria-hidden strokeWidth={1.75} className="size-5 text-text-muted" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium text-text">Shared memory</h2>
            <p className="text-xs text-text-muted">
              Facts and a session journal every agent reads and keeps current, in{' '}
              <code>agents/memory/</code>.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void openSharedNote(AGENT_SHARED_FACTS_PATH)}
          >
            Facts
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void openSharedNote(AGENT_SHARED_LOG_PATH)}
          >
            Journal
          </Button>
        </div>
        <div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
          <div className="min-w-0 flex-1">
            <span id="memory-approval-label" className="text-sm text-text">
              Approve memory writes
            </span>
            <p className="text-xs text-text-muted">
              Agents propose changes to “About you” and shared facts here instead of writing them
              directly.
            </p>
          </div>
          <Switch
            aria-labelledby="memory-approval-label"
            checked={settings.memoryWriteApproval}
            onCheckedChange={(checked) => updateSettings({ memoryWriteApproval: checked })}
          />
        </div>
        {(pending.data ?? []).length > 0 ? (
          <ul className="mt-3 space-y-2 border-t border-border pt-3">
            {(pending.data ?? []).map((proposal, position) => {
              // The memory-write scanner runs on every staged proposal:
              // planted instructions and secrets get flagged right where
              // the user decides — approval stays theirs, but informed.
              const findings = scanMemoryContent(proposal.body)
              // Heading + position: same-day proposals to one target share a
              // heading, and the list re-derives from the file on every
              // change, so positional identity is stable enough here.
              return (
                <li
                  key={`${proposal.heading}#${position}`}
                  className="rounded-lg bg-surface-sunken p-3"
                >
                  <p className="text-xs font-medium text-text-secondary">
                    {proposal.heading.replace(/^##\s*/, '')}
                  </p>
                  <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-text">
                    {proposal.body}
                  </pre>
                  {findings.length > 0 ? (
                    <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 p-2">
                      {findings.map((finding, index) => (
                        <p
                          key={index}
                          className="flex items-start gap-1.5 text-xs text-destructive"
                        >
                          <TriangleAlert aria-hidden className="mt-0.5 size-3 shrink-0" />
                          <span>
                            Line {finding.line} {finding.reason}: “{finding.excerpt}”
                          </span>
                        </p>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-2 flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void resolvePending(proposal, 'approve')}
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void resolvePending(proposal, 'discard')}
                    >
                      Discard
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>

      <section className="mt-4 space-y-2">
        <button
          type="button"
          onClick={() => activate(null)}
          aria-pressed={activeSlug === null}
          className={cn(
            'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors duration-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
            activeSlug === null
              ? 'border-border bg-surface shadow-sm'
              : 'border-transparent hover:bg-surface-hover',
          )}
        >
          <Bot aria-hidden strokeWidth={1.75} className="size-5 text-text-muted" />
          <div className="min-w-0 flex-1">
            <span className="text-sm font-medium text-text">No agent</span>
            <p className="text-xs text-text-muted">Plain assistant — no soul, default memory.</p>
          </div>
          {activeSlug === null ? <span className="text-xs text-accent">Active</span> : null}
        </button>

        {list.map((profile) => (
          <div
            key={profile.slug}
            className={cn(
              'rounded-xl border px-4 py-3 transition-colors duration-100',
              activeSlug === profile.slug
                ? 'border-border bg-surface shadow-sm'
                : 'border-transparent hover:bg-surface-hover',
            )}
          >
            <div className="flex items-center gap-3">
              <Bot aria-hidden strokeWidth={1.75} className="size-5 text-text-muted" />
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-text">{profile.name}</span>
                <p className="truncate text-xs text-text-muted">
                  agents/{profile.slug}
                  {profile.provider === null ? '' : ` · ${providerLabel(profile.provider)}`}
                  {profile.model === null ? '' : ` · ${profile.model}`}
                </p>
              </div>
              {activeSlug === profile.slug ? (
                <span className="text-xs text-accent">Active</span>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => activate(profile)}>
                  Use
                </Button>
              )}
            </div>
            <div className="mt-2 flex items-center gap-1 pl-8">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => openNote(profile.soulPath)}
              >
                Soul
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => openNote(profile.memoryPath)}
              >
                Memory
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${profile.name}`}
                className="ml-auto text-text-muted hover:text-destructive"
                onClick={() => void remove(profile)}
              >
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </div>
          </div>
        ))}

        {profiles.isPending ? (
          <p className="px-4 py-2 text-sm text-text-muted">Loading agents…</p>
        ) : null}
        {!profiles.isPending && list.length === 0 ? (
          <p className="px-4 py-2 text-sm text-text-muted">
            No agents yet — create one to give your AI a soul and a memory of its own.
          </p>
        ) : null}
      </section>

      <AgentRoutinesSection profiles={list} />

      <NewAgentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(profile) => {
          refresh()
          activate(profile)
          openNote(profile.soulPath)
        }}
      />
    </div>
  )
}

interface NewAgentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (profile: AgentProfile) => void
}

/** Name + optional provider pin → seeded soul and memory under agents/. */
function NewAgentDialog({ open, onOpenChange, onCreated }: NewAgentDialogProps): ReactElement {
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
