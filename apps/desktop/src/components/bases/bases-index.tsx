import type { ReactElement } from 'react'
import { baseDisplayName } from '@kore/core'
import { TableView } from '@/components/icons'
import { PageLoading } from '@/components/page-loading'
import { EmptyState } from '@/components/ui/empty-state'
import { PageBody, PageHeader } from '@/components/ui/page-header'
import { useRouter } from '@/routing/router'
import { ConvertToTypes } from './convert-to-types'
import { useBaseFiles } from './use-base-view'

/** Every `.base` file in the vault, each opening its Base screen. */
export function BasesIndex(): ReactElement {
  const { navigate } = useRouter()
  const { paths, failed } = useBaseFiles()
  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <PageHeader
        title="Bases"
        description="Obsidian bases in this vault, shown live over your notes."
      />
      {failed ? (
        <p role="alert" className="pr-7 pl-12 text-sm text-text-muted">
          Couldn’t list the bases.
        </p>
      ) : paths === undefined ? (
        <PageLoading label="Loading bases" />
      ) : paths.length === 0 ? (
        <EmptyState
          icon={TableView}
          title="No bases yet"
          description="A base you build in Obsidian shows up here, live over your notes, the moment its file is in the vault."
          className="my-auto"
        />
      ) : (
        <PageBody>
          <ConvertToTypes paths={paths} label="Convert bases to type views" />
          <ul className="-mx-2 mt-6 flex flex-col">
            {paths.map((path) => (
              <li key={path}>
                <button
                  type="button"
                  onClick={() => {
                    navigate({ kind: 'base', path, view: null })
                  }}
                  className="flex w-full min-w-0 items-baseline gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover"
                >
                  <span className="text-[13px] font-medium text-text">{baseDisplayName(path)}</span>
                  <span className="min-w-0 truncate text-xs text-text-muted">{path}</span>
                </button>
              </li>
            ))}
          </ul>
        </PageBody>
      )}
    </div>
  )
}
