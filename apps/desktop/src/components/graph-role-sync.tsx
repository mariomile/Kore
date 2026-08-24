import { useEffect, type ReactElement } from 'react'
import { errorMessage } from '@reflect/core'
import { ensureCompanyGraphSeed } from '@/lib/company-graph-seed'
import { readGraphRole, takeQueuedGraphRole, writeGraphRole } from '@/lib/graph-role'
import { useGraph } from '@/providers/graph-provider'
import { useSettings } from '@/providers/settings-provider'

/**
 * After a graph opens: apply a queued chooser role, refresh the settings
 * cache from `graph.md`, and seed company types when this is a company brain.
 */
export function GraphRoleSync(): ReactElement | null {
  const { graph } = useGraph()
  const { updateSettingsWith } = useSettings()

  useEffect(() => {
    if (graph === null) {
      return
    }
    const root = graph.root
    const generation = graph.generation
    let cancelled = false
    void (async () => {
      try {
        const queued = takeQueuedGraphRole()
        if (queued !== null) {
          await writeGraphRole(queued, generation)
          if (queued === 'company') {
            await ensureCompanyGraphSeed(generation)
          }
          if (!cancelled) {
            updateSettingsWith((current) => ({
              graphRoles: { ...current.graphRoles, [root]: queued },
            }))
          }
          return
        }
        const role = await readGraphRole(generation)
        if (cancelled) {
          return
        }
        if (role !== null) {
          updateSettingsWith((current) => ({
            graphRoles: { ...current.graphRoles, [root]: role },
          }))
          if (role === 'company') {
            await ensureCompanyGraphSeed(generation)
          }
        }
      } catch (cause) {
        console.error('graph role sync failed:', errorMessage(cause))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [graph, updateSettingsWith])

  return null
}
