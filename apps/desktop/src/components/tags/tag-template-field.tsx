import type { ReactElement } from 'react'
import { Note } from '@/components/icons'
import { TagSettingRow, TagSettingSelect } from './tag-setting-row'

interface TagTemplateFieldProps {
  /** The stored template path, or null for a blank note. */
  template: string | null
  templates: readonly { path: string; title: string }[]
  onChange: (template: string | null) => void
  touch?: boolean
}

/** The template a new note of this tag starts from (`template:` on the definition). */
export function TagTemplateField({
  template,
  templates,
  onChange,
  touch = false,
}: TagTemplateFieldProps): ReactElement {
  return (
    <TagSettingRow
      icon={Note}
      title="Template"
      description={
        templates.length === 0 ? 'No templates in this vault yet' : 'Starts every new note'
      }
      touch={touch}
    >
      <TagSettingSelect
        label="New-row template"
        value={template}
        noneLabel="Blank note"
        options={templates.map((entry) => ({ value: entry.path, label: entry.title }))}
        onChange={onChange}
      />
    </TagSettingRow>
  )
}
