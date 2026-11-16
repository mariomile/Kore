import { useMemo } from 'react'
import { getVaultLayout, type FolderTreeFolder } from '@kore/core'
import { useFolderTree } from '@/hooks/use-folder-tree'

/**
 * Every folder of the vault a note can live in, depth-first by path: the
 * Folders shelf's tree flattened, without Kore's own `tags/` and templates
 * folders (`tags/` holds type definitions). The type settings' Folder
 * field offers these.
 */
export function useVaultFolders(): string[] {
  const tree = useFolderTree()
  return useMemo(() => {
    const skipped = new Set(['tags', getVaultLayout().templatesFolder])
    const out: string[] = []
    const walk = (folder: FolderTreeFolder): void => {
      for (const child of folder.folders) {
        if (skipped.has(child.path)) {
          continue
        }
        out.push(child.path)
        walk(child)
      }
    }
    if (tree !== null) {
      walk(tree)
    }
    return out
  }, [tree])
}
