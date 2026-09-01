import { useState, type KeyboardEvent, type ReactElement } from 'react'
import { ShortcutKeys } from '@/components/shortcut-keys'
import { Button } from '@/components/ui/button'
import { isShortcutModifierCode, quickCaptureBindingFromEvent } from '@/lib/quick-capture-shortcut'
import { useSettings } from '@/providers/settings-provider'
import { SettingsField } from './field'

/** Settings recorder for the system-wide shortcut that opens Quick Entry. */
export function QuickEntryShortcutField(): ReactElement {
  const { settings, updateSettings } = useSettings()
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!recording) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      setRecording(false)
      setError(null)
      return
    }
    if (isShortcutModifierCode(event.code)) {
      return
    }
    const binding = quickCaptureBindingFromEvent(event)
    if (binding === null) {
      setError('Use a letter, number, arrow, or punctuation key with Command, Ctrl, or Alt.')
      return
    }
    updateSettings({ quickCaptureShortcut: binding })
    setRecording(false)
    setError(null)
  }

  return (
    <SettingsField
      legend="Quick Entry shortcut"
      description="Click the shortcut, then press the key combination you want to use anywhere."
    >
      <Button
        type="button"
        variant="outline"
        aria-label="Quick Entry shortcut"
        aria-pressed={recording}
        onClick={() => {
          setRecording(true)
          setError(null)
        }}
        onBlur={() => setRecording(false)}
        onKeyDown={onKeyDown}
        className="mt-3 min-w-44 justify-between gap-4 font-normal aria-pressed:border-ring aria-pressed:ring-3 aria-pressed:ring-ring/30"
      >
        {recording ? (
          <span className="text-text-muted">Press shortcut…</span>
        ) : (
          <ShortcutKeys binding={settings.quickCaptureShortcut} />
        )}
        <span className="text-xs text-text-muted">{recording ? 'Esc to cancel' : 'Change'}</span>
      </Button>
      {error !== null ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </SettingsField>
  )
}
