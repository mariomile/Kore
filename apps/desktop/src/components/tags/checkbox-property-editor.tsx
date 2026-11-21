import type { ReactElement } from 'react'
import { cn } from '@/lib/utils'
import type { PropertyEditorProps } from './property-editor-shared'

/** A checkbox property edits in place — the display is the control. */
export function CheckboxPropertyEditor({
  property,
  value,
  onCommit,
  children,
  variant = 'default',
}: PropertyEditorProps): ReactElement {
  const checked = value?.valueType === 'boolean' && value.value === 'true'
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={property.name}
      className={cn(
        'flex min-w-0 items-center self-stretch focus-visible:outline-none',
        variant === 'table-cell'
          ? 'h-full w-full justify-center px-2.5 transition-colors hover:bg-surface-hover/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent'
          : 'min-h-5',
      )}
      onClick={(event) => {
        event.stopPropagation()
        onCommit(!checked)
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {children}
    </button>
  )
}
