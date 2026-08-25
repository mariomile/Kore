import type { ReactElement } from 'react'
import type { PropertyEditorProps } from './property-editor-shared'

/** A checkbox property edits in place — the display is the control. */
export function CheckboxPropertyEditor({
  property,
  value,
  onCommit,
  children,
}: PropertyEditorProps): ReactElement {
  const checked = value?.valueType === 'boolean' && value.value === 'true'
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={property.name}
      className="flex min-h-5 min-w-0 items-center self-stretch focus-visible:outline-none"
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
