import { useId, useState, type ReactElement } from 'react'
import { Input } from '@/components/ui/input'
import type { ConnectorView, UseConnectorsResult } from '@/hooks/use-connectors'

type LayoutActions = Pick<UseConnectorsResult, 'setFolder' | 'setPattern' | 'setTags'>

interface ConnectorLayoutFieldsProps {
  view: ConnectorView
  actions: LayoutActions
  /** Shows a validation problem (or clears it with `null`). */
  onProblem: (problem: string | null) => void
}

/**
 * Where a connected source writes and how its notes look: the folder, the
 * file name pattern (`/` for subfolders, `{field}` for the item's values)
 * and the tags new notes carry. Every field commits on blur or Enter;
 * shared by the desktop settings row and the mobile drawer.
 */
export function ConnectorLayoutFields({
  view,
  actions,
  onProblem,
}: ConnectorLayoutFieldsProps): ReactElement {
  const { connector, settings } = view
  const fields = connector.patternFields.map((field) => `{${field}}`).join(' ')
  return (
    <div className="grid gap-2">
      <CommitField
        label="Folder"
        value={settings.folder ?? connector.defaultFolder}
        placeholder="Graph root"
        onCommit={(value) => actions.setFolder(connector.id, value)}
        onProblem={onProblem}
      />
      <CommitField
        label="File name"
        value={settings.pattern ?? connector.defaultPattern}
        placeholder={connector.defaultPattern}
        hint={`Fields: ${fields}. Use / for subfolders.`}
        onCommit={(value) => actions.setPattern(connector.id, value)}
        onProblem={onProblem}
      />
      <CommitField
        label="Tags"
        value={(settings.tags ?? connector.defaultTags).join(', ')}
        placeholder={connector.defaultTags.join(', ')}
        hint="Added to new notes, comma-separated."
        onCommit={(value) => {
          actions.setTags(connector.id, value)
          return null
        }}
        onProblem={onProblem}
      />
    </div>
  )
}

interface CommitFieldProps {
  label: string
  value: string
  placeholder: string
  hint?: string
  /** Saves the draft; returns a problem to show instead, or `null`. */
  onCommit: (value: string) => string | null
  onProblem: (problem: string | null) => void
}

function CommitField({
  label,
  value,
  placeholder,
  hint,
  onCommit,
  onProblem,
}: CommitFieldProps): ReactElement {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)

  function commit(): void {
    if (draft === null) {
      return
    }
    const problem = onCommit(draft)
    onProblem(problem)
    if (problem === null) {
      setDraft(null)
    }
  }

  return (
    <div className="grid grid-cols-[5rem_1fr] items-center gap-x-2 gap-y-0.5">
      <label className="text-xs text-text-muted" htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        value={draft ?? value}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit()
          }
        }}
        placeholder={placeholder}
        className="text-xs"
      />
      {hint === undefined ? null : (
        <p className="col-start-2 text-[11px] text-text-muted">{hint}</p>
      )}
    </div>
  )
}
