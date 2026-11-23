import type { ReactElement } from 'react'
import { isFolderNoteHome, typeHomeFolder, TYPE_FOLDER_TITLE_SEGMENT } from '@kore/core'
import { Folder } from '@/components/icons'
import { TagSettingRow, TagSettingSelect } from './tag-setting-row'

interface TagFolderFieldProps {
  /** The type's `folder:` as stored (may end in `/{title}`), or null. */
  folder: string | null
  /** Folders to offer (the vault's, depth-first). */
  folders: readonly string[]
  onChange: (folder: string | null) => void
  touch?: boolean
}

/**
 * The type's home folder (`folder:` on the definition): new notes of the
 * type are born there, from any surface (a table row, a relation, the CLI,
 * an agent). Existing notes never move. A `/{title}` suffix written in the
 * tag file (each note in its own folder) is kept as stored, not offered here.
 */
export function TagFolderField({
  folder,
  folders,
  onChange,
  touch = false,
}: TagFolderFieldProps): ReactElement {
  const base = folder === null ? null : typeHomeFolder(folder)
  const perNote = folder !== null && isFolderNoteHome(folder)
  // A stored folder that no longer exists still shows, so a save keeps it.
  const options = base !== null && !folders.includes(base) ? [base, ...folders] : folders
  return (
    <TagSettingRow
      icon={Folder}
      title="Folder"
      description={folderDescription(base, perNote)}
      touch={touch}
    >
      <TagSettingSelect
        label="Folder for new notes"
        value={base}
        noneLabel="Default folder"
        options={options.map((path) => ({ value: path, label: path }))}
        onChange={(next) =>
          onChange(next !== null && perNote ? `${next}/${TYPE_FOLDER_TITLE_SEGMENT}` : next)
        }
      />
    </TagSettingRow>
  )
}

function folderDescription(base: string | null, perNote: boolean): string {
  if (base === null) {
    return 'Where new notes go'
  }
  return perNote
    ? 'New notes go here, each in its own folder'
    : 'New notes go here. Existing ones stay put.'
}
