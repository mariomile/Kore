import type { Settings, TaskView } from '@reflect/core'
import { useSettings } from '@/providers/settings-provider'

/** How the Tasks view lays its groups out. */
export type TaskLayout = Settings['taskLayout']

export interface TaskViewControl {
  view: TaskView
  setView: (view: TaskView) => void
  layout: TaskLayout
  setLayout: (layout: TaskLayout) => void
}

/**
 * The open Tasks view and its layout, persisted in the settings document
 * (`taskView`, `taskLayout`) like the task filters, so both survive relaunch
 * and stay in step across every mounted reader.
 */
export function useTaskView(): TaskViewControl {
  const { settings, updateSettings } = useSettings()
  return {
    view: settings.taskView,
    setView: (view) => updateSettings({ taskView: view }),
    layout: settings.taskLayout,
    setLayout: (layout) => updateSettings({ taskLayout: layout }),
  }
}
