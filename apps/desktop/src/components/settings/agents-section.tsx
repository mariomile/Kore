import { useState, type ReactElement } from 'react'
import { Badge } from '@/components/ui/badge'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from '@/components/icons'
import {
  agentSkillInstall,
  agentSkillStatus,
  agentSkillUninstall,
  errorMessage,
  type AgentSkillsStatus,
} from '@kore/core'
import { AgentsMcpField } from '@/components/settings/agents-mcp-field'
import { AgentsMemoryKitField } from '@/components/settings/agents-memory-kit-field'
import { AgentsRemoteAccessField } from '@/components/settings/agents-remote-access-field'
import { AgentsRepoAccessField } from '@/components/settings/agents-repo-access-field'
import { SettingsField } from '@/components/settings/field'
import { SettingsSection } from '@/components/settings/section'
import { Button } from '@/components/ui/button'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { isMacosDesktop } from '@/lib/platform'
import { useGraph } from '@/providers/graph-provider'

/**
 * Settings → Agents → Agent access: every way another agent reaches this
 * vault, grouped by where the agent runs — the one question a user can
 * answer without knowing what MCP is. On this Mac: the bundled skills
 * (`~/.agents/skills/`, teaching coding agents the `kore` CLI and Kore's
 * formats), the copyable `kore mcp` setup ({@link AgentsMcpField}) and the
 * memory kit. In the cloud: remote access ({@link AgentsRemoteAccessField}).
 * With their own computer: the GitHub repository they clone
 * ({@link AgentsRepoAccessField}). Each group states when it works, so the
 * Mac-must-be-awake limits are visible up front. macOS desktop only, like the
 * iCloud section — the navigator hides the entry through the same gate (see
 * use-visible-settings-sections).
 */
export function AgentsSection(): ReactElement | null {
  const { graph } = useGraph()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const queryKey = ['agent-skill', graph?.root]
  const bridgeReady = useBridgeReady()
  const { data: status } = useQuery({
    queryKey,
    queryFn: agentSkillStatus,
    enabled: bridgeReady && isMacosDesktop && graph !== null,
  })

  if (!isMacosDesktop || graph === null) {
    return null
  }

  async function run(action: (generation: number) => Promise<AgentSkillsStatus>): Promise<void> {
    if (graph === null) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      queryClient.setQueryData(queryKey, await action(graph.generation))
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const skills = status?.skills ?? []
  const installable = skills.filter(
    (skill) => skill.installState === 'missing' || skill.installState === 'stale',
  )
  const managed = skills.filter(
    (skill) => skill.installState === 'current' || skill.installState === 'stale',
  )
  const allInstalled =
    skills.length > 0 && skills.every((skill) => skill.installState === 'current')
  const anyStale = skills.some((skill) => skill.installState === 'stale')
  return (
    <SettingsSection id="agents">
      <AgentAccessGroup
        title="On this Mac"
        agents="Claude Code, Codex, Cursor, Claude Desktop"
        availability="While this Mac is on"
      />
      <SettingsField
        legend="Agent skills"
        description={`Teach Claude Code and other agents to read and write “${graph.name}” with the kore CLI, and the formats Kore uses: markdown, collections, agent memory.`}
      >
        {status !== undefined ? (
          <div className="mt-2 flex flex-col gap-2">
            <p className="truncate font-mono text-xs text-text-muted" title={status.skillsRoot}>
              {status.skillsRoot}
            </p>
            <ul className="flex flex-col gap-1">
              {skills.map((skill) => (
                <li key={skill.skillName} className="flex items-center gap-2 text-xs">
                  <span className="font-mono">{skill.skillName}</span>
                  {skill.installState === 'current' ? (
                    <span className="inline-flex items-center gap-1 text-text-secondary">
                      <Check aria-hidden className="size-3.5" />
                      Installed
                    </span>
                  ) : skill.installState === 'stale' ? (
                    <span className="text-text-secondary">Update available</span>
                  ) : skill.installState === 'conflict' ? (
                    <span className="text-destructive">
                      A file Kore doesn’t manage is already there. Move it aside to install.
                    </span>
                  ) : (
                    <span className="text-text-muted">Not installed</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              {allInstalled ? (
                <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
                  <Check aria-hidden className="size-3.5" />
                  Installed
                </span>
              ) : installable.length > 0 ? (
                <Button size="xs" disabled={busy} onClick={() => void run(agentSkillInstall)}>
                  {anyStale ? 'Update skills' : 'Install skills'}
                </Button>
              ) : null}
              {managed.length > 0 ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(agentSkillUninstall)}
                >
                  Remove
                </Button>
              ) : null}
            </div>
            {error !== null ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        ) : null}
      </SettingsField>
      {status !== undefined ? (
        <AgentsMcpField cliPath={status.cliPath} graphName={graph.name} />
      ) : null}
      <AgentsMemoryKitField graphRoot={graph.root} generation={graph.generation} />
      <AgentAccessGroup
        title="In the cloud"
        agents="Claude on the web and iPhone, ChatGPT, Grok"
        availability="While Kore is open"
      />
      <AgentsRemoteAccessField graphName={graph.name} />
      <AgentAccessGroup
        title="With their own computer"
        agents="Claude Code on the web, Codex cloud"
        availability="Always"
      />
      <AgentsRepoAccessField />
    </SettingsSection>
  )
}

/**
 * A group heading row inside the Agent access card: where the agents run,
 * which agents those are, and when that path works.
 */
function AgentAccessGroup({
  title,
  agents,
  availability,
}: {
  title: string
  agents: string
  availability: string
}): ReactElement {
  return (
    <div className="flex items-start justify-between gap-3 bg-surface-sunken px-4 py-2.5 first:rounded-t-lg">
      <div className="min-w-0">
        <h3 className="text-xs font-semibold text-text">{title}</h3>
        <p className="mt-0.5 text-xs text-text-muted">{agents}</p>
      </div>
      <Badge variant="secondary" className="mt-0.5">
        {availability}
      </Badge>
    </div>
  )
}
