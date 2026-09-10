import { useState, type ReactElement } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from '@/components/icons'
import {
  agentSkillInstall,
  agentSkillStatus,
  agentSkillUninstall,
  errorMessage,
  type AgentSkillsStatus,
} from '@reflect/core'
import { SettingsField } from '@/components/settings/field'
import { SettingsSection } from '@/components/settings/section'
import { Button } from '@/components/ui/button'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { isMacosDesktop } from '@/lib/platform'
import { useGraph } from '@/providers/graph-provider'

/**
 * Settings → Agents: one-click install of the bundled agent skills under
 * `~/.agents/skills/` — the graph's own skill (named after it; teaches
 * coding agents to read this graph through the bundled `reflect` CLI) plus
 * the shared format skills (markdown, collections, agent memory). macOS
 * desktop only, like the iCloud section — the navigator hides the entry
 * through the same gate (see use-visible-settings-sections).
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
      <SettingsField
        legend="Agent skills"
        description={`Teach Claude Code and other agents to read and write “${graph.name}” with the reflect CLI, and the formats Kore uses: markdown, collections, agent memory.`}
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
    </SettingsSection>
  )
}
