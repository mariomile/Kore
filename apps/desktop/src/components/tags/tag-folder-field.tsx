import type { ReactElement } from 'react'
import { isFolderNoteHome, typeHomeFolder, TYPE_FOLDER_TITLE_SEGMENT } from '@kore/core'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface TagFolderFieldProps {
  /** The type's `folder:` as stored (may end in `/{title}`), or null. */
  folder: string | null
  /** Folders to offer (the vault's, depth-first). */
  folders: readonly string[]
  onChange: (folder: string | null) => void
  labelClassName: string
  triggerClassName?: string
}

const NONE = 'none'

/**
 * The type's home folder (`folder:` on the definition): new notes of the
 * type are born there, from any surface (a table row, a relation, the CLI,
 * an agent). Existing notes never move. "A folder for each note" stores the
 * `{title}` form, the layout of a project folder with its note inside.
 */
export function TagFolderField({
  folder,
  folders,
  onChange,
  labelClassName,
  triggerClassName,
}: TagFolderFieldProps): ReactElement {
  const base = folder === null ? null : typeHomeFolder(folder)
  const perNote = folder !== null && isFolderNoteHome(folder)
  // A stored folder that no longer exists still shows, so a save keeps it.
  const options = base !== null && !folders.includes(base) ? [base, ...folders] : folders
  const pick = (next: string | null, eachInOwn: boolean): void => {
    onChange(next === null ? null : eachInOwn ? `${next}/${TYPE_FOLDER_TITLE_SEGMENT}` : next)
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className={labelClassName}>Folder</span>
        <Select
          value={base ?? NONE}
          items={{ [NONE]: 'None', ...Object.fromEntries(options.map((path) => [path, path])) }}
          onValueChange={(value) => {
            if (typeof value === 'string') {
              pick(value === NONE ? null : value, perNote)
            }
          }}
        >
          <SelectTrigger
            aria-label="Folder for new notes"
            className={cn('min-w-44', triggerClassName)}
          >
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None</SelectItem>
            {options.map((path) => (
              <SelectItem key={path} value={path}>
                {path}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {base !== null ? (
        <div className="flex flex-col gap-1.5 pl-[calc(var(--field-label-w,7rem)+0.5rem)]">
          <label className="flex min-h-6 items-center gap-2 text-xs text-text-secondary">
            <Checkbox checked={perNote} onCheckedChange={(checked) => pick(base, checked)} />A
            folder for each note
          </label>
          <p className="text-xs leading-4 text-text-muted">
            New notes are born in{' '}
            <code className="font-mono">{perNote ? `${base}/<Name>/<Name>.md` : `${base}/`}</code>.
            Existing notes stay where they are.
          </p>
        </div>
      ) : null}
    </div>
  )
}
