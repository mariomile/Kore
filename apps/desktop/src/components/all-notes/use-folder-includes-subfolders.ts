import { useCallback } from 'react'
import { useSettings } from '@/providers/settings-provider'

/**
 * Whether a folder page lists its subfolders' notes too. On unless the user
 * turned it off for that folder (see `folderPagesWithoutSubfolders`), and
 * remembered per folder across visits.
 */
export function useFolderIncludesSubfolders(
  folder: string | null,
): readonly [boolean, (include: boolean) => void] {
  const { settings, updateSettingsWith } = useSettings()
  const include = folder === null || !settings.folderPagesWithoutSubfolders.includes(folder)
  const setInclude = useCallback(
    (next: boolean) => {
      if (folder === null) {
        return
      }
      updateSettingsWith((current) => {
        const others = current.folderPagesWithoutSubfolders.filter((path) => path !== folder)
        return { folderPagesWithoutSubfolders: next ? others : [...others, folder] }
      })
    },
    [folder, updateSettingsWith],
  )
  return [include, setInclude]
}
