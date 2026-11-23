import type { ReactElement } from 'react'
import { isInExcludedFolder } from '@kore/core'
import { Close, Folder } from '@/components/icons'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useVaultFolders } from '@/hooks/use-vault-folders'
import { saveSemanticExclusions, useSemanticExclusions } from '@/lib/semantic-exclusions'
import { useGraph } from '@/providers/graph-provider'
import { SettingsField } from './field'

/**
 * Settings → Search → Excluded folders: the vault's folders kept out of the
 * semantic index (`lib/semantic-exclusions`). Adding one drops its notes'
 * vectors on the spot and removing one embeds them again, both through the
 * embedding sync's backfill; keyword search never changes. Offers only
 * folders not already covered by an excluded parent.
 */
export function SemanticExcludedFoldersField(): ReactElement | null {
  const { graph } = useGraph()
  const excluded = useSemanticExclusions()
  const folders = useVaultFolders()
  if (graph === null || excluded === null) {
    return null
  }
  const generation = graph.generation
  // The trailing slash makes an excluded folder count as inside itself.
  const offered = folders.filter((folder) => !isInExcludedFolder(`${folder}/`, excluded))
  return (
    <SettingsField
      legend="Excluded folders"
      description="Notes in these folders are left out of search by meaning and Similar notes. Keyword search still finds them. Saved in the vault."
    >
      {excluded.length > 0 ? (
        <ul aria-label="Excluded folders" className="mt-3 flex flex-col gap-1">
          {excluded.map((folder) => (
            <li
              key={folder}
              className="flex items-center gap-2 rounded-md bg-surface-hover py-1 pr-1 pl-2.5"
            >
              <Folder aria-hidden className="size-3.5 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1 truncate text-xs text-text">{folder}</span>
              <button
                type="button"
                aria-label={`Include ${folder} again`}
                onClick={() =>
                  void saveSemanticExclusions(
                    excluded.filter((other) => other !== folder),
                    generation,
                  )
                }
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors duration-100 hover:bg-surface-active hover:text-text"
              >
                <Close aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3">
        <Select
          value={null}
          onValueChange={(value) => {
            if (typeof value === 'string') {
              void saveSemanticExclusions([...excluded, value], generation)
            }
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label="Exclude a folder"
            disabled={offered.length === 0}
            className="min-w-44 text-xs"
          >
            <SelectValue placeholder="Exclude a folder…" />
          </SelectTrigger>
          <SelectContent>
            {offered.map((folder) => (
              <SelectItem key={folder} value={folder}>
                {folder}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </SettingsField>
  )
}
