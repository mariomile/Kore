import type { ReactElement } from 'react'
import { Bot } from '@/components/icons'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'

/**
 * "Show who wrote each line" in Note actions: flips the `editorLineAuthors`
 * setting (Plan 33, A3), the same switch as Settings → Editor. Off by
 * default; it applies to every note, since it is a way of reading the vault
 * rather than a property of one note.
 */
export function LineAuthorsAction(): ReactElement {
  const { settings, updateSettings } = useSettings()
  const active = settings.editorLineAuthors
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => updateSettings({ editorLineAuthors: !active })}
      className="group relative flex w-full items-center space-x-2 rounded-lg px-3 py-2 text-start transition-colors duration-100 hover:bg-surface-hover"
    >
      <span
        className={cn(
          'flex h-5 w-5 flex-none items-center justify-center transition-colors duration-100',
          active ? 'text-accent' : 'text-text-muted group-hover:text-text',
        )}
      >
        <Bot size={14} aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium">
        {active ? 'Hide who wrote each line' : 'Show who wrote each line'}
      </span>
    </button>
  )
}
