import type { ReactElement } from 'react'
import { Download, Refresh } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useUpdate } from '@/providers/update-provider'
import { SettingsField } from './field'

/**
 * The manual path to the same updater the app checks on launch: one button
 * whose label tracks the update lifecycle, with the outcome reported inline.
 */
export function UpdateField(): ReactElement {
  const { state, checkNow, install, restart } = useUpdate()

  const action: {
    label: string
    icon: typeof Refresh
    run?: (() => Promise<void>) | undefined
    spinning?: boolean | undefined
  } = (() => {
    switch (state.phase) {
      case 'checking':
        return { label: 'Checking…', icon: Refresh, run: undefined, spinning: true }
      case 'available':
        return { label: `Install ${state.version}`, icon: Download, run: install }
      case 'downloading':
        return {
          label: `Downloading${state.percent !== null ? ` ${state.percent}%` : '…'}`,
          icon: Download,
          run: undefined,
        }
      case 'ready':
        return { label: 'Restart to update', icon: Refresh, run: restart }
      case 'error':
        // Retry what actually failed: a failed install still has its found
        // update (same contract as the sidebar row); a failed check re-checks.
        return state.during === 'install'
          ? { label: 'Retry install', icon: Download, run: install }
          : { label: 'Check for updates', icon: Refresh, run: checkNow }
      default:
        return { label: 'Check for updates', icon: Refresh, run: checkNow }
    }
  })()

  const run = action.run
  return (
    <SettingsField
      legend="Updates"
      description="Memento checks for new versions on launch and installs them only when you say so."
    >
      <div className="mt-3 flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={run === undefined}
          onClick={run ? () => void run() : undefined}
          className="text-text-secondary"
        >
          <action.icon aria-hidden className={action.spinning ? 'animate-spin' : undefined} />
          {action.label}
        </Button>
        {state.phase === 'upToDate' ? (
          <span role="status" className="text-xs text-text-muted">
            You're up to date.
          </span>
        ) : null}
        {state.phase === 'error' ? (
          <span role="alert" className="text-xs text-red-500">
            {state.message}
          </span>
        ) : null}
      </div>
    </SettingsField>
  )
}
