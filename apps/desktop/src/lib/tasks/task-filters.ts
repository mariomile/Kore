import type { TaskFilters } from '@reflect/core'
import { useSettings } from '@/providers/settings-provider'

export type { TaskFilters } from '@reflect/core'

export interface TaskFiltersControl {
  filters: TaskFilters
  toggle: (key: keyof TaskFilters) => void
}

/**
 * The Tasks view's filter state. Persisted in the settings document (the
 * `taskFilters` key) so a filter choice survives relaunch — V1 kept these per
 * session, which reset every launch. The settings provider already shares
 * updates live across every mounted reader, desktop and mobile alike.
 */
export function useTaskFilters(): TaskFiltersControl {
  const { settings, updateSettings } = useSettings()
  const filters = settings.taskFilters

  return {
    filters,
    toggle: (key) => updateSettings({ taskFilters: { ...filters, [key]: !filters[key] } }),
  }
}
