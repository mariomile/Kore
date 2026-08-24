import { useCallback } from 'react'
import type { GraphRole } from '@reflect/core'
import { ensureCompanyGraphSeed } from '@/lib/company-graph-seed'
import { writeGraphRole } from '@/lib/graph-role'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'

interface GraphRoleValue {
  /** Cached role for any root (recents), or `null` when unknown. */
  roleFor: (root: string) => GraphRole | null
  /** Role of the open graph. */
  role: GraphRole | null
  /** Persist a role to `graph.md` and the settings cache. */
  setRole: (role: GraphRole) => Promise<void>
}

/**
 * Personal vs Company role. `graph.md` is the source of truth; settings
 * cache the last read so the chooser and footer can badge recents.
 */
export function useGraphRole(): GraphRoleValue {
  const { graph } = useGraph()
  const { settings, updateSettingsWith } = useSettings()
  const roles = settings.graphRoles ?? {}

  const roleFor = useCallback((root: string): GraphRole | null => roles[root] ?? null, [roles])

  const setRole = useCallback(
    async (role: GraphRole): Promise<void> => {
      if (graph === null) {
        return
      }
      await writeGraphRole(role, graph.generation)
      if (role === 'company') {
        await ensureCompanyGraphSeed(graph.generation)
      }
      updateSettingsWith((current) => ({
        graphRoles: { ...current.graphRoles, [graph.root]: role },
      }))
    },
    [graph, updateSettingsWith],
  )

  return {
    roleFor,
    role: graph === null ? null : (roles[graph.root] ?? null),
    setRole,
  }
}
