import type { ReactElement } from 'react'
import { OptionsListEditor } from './options-list-editor'
import { optionsPatch, type PropertyDraft } from './tag-config-drafts'
import { useOptionUsage } from './use-option-usage'

interface PropertyOptionsFieldProps {
  /** The tag whose notes the options' use is counted on. */
  tag: string
  draft: PropertyDraft
  updateDraft: (rowId: number, patch: Partial<PropertyDraft>) => void
  /** Phone layout: 48pt rows and larger type. */
  touch?: boolean
}

/**
 * A select/status property's options, wired to its draft: the list editor
 * plus how many notes use each stored option, so deleting one can say what
 * it touches. Shared by the Mac dialog and the iPhone field page.
 */
export function PropertyOptionsField({
  tag,
  draft,
  updateDraft,
  touch = false,
}: PropertyOptionsFieldProps): ReactElement {
  const usage = useOptionUsage(tag, draft.originalKey)
  return (
    <OptionsListEditor
      touch={touch}
      options={draft.options}
      usage={usage}
      onChange={(options) => updateDraft(draft.rowId, optionsPatch(draft, options))}
    />
  )
}
