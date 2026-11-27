import type { ReactElement } from 'react'
import { baseDisplayName } from '@kore/core'
import { PageLoading } from '@/components/page-loading'
import { PageHeader } from '@/components/ui/page-header'
import { isMobileSurface } from '@/lib/platform-surface'
import { BaseDatabasePage } from './base-database-page'
import { BasesIndex } from './bases-index'
import { MobileBaseDatabasePage } from './mobile-base-database-page'
import { useBaseDatabase } from './use-base-view'

interface BaseScreenProps {
  /** The `.base` file, or null for the list of every base. */
  path: string | null
  view: string | null
}

/**
 * An Obsidian base as a database: its views as tabs under the type page's
 * view bar (Mac) or views sheet (iPhone). Bar changes are written into the
 * `.base` file, so the same base keeps working in Obsidian; cells edit the
 * notes' own frontmatter, and "+ New" adds a note the view implies.
 */
export function BaseScreen({ path, view }: BaseScreenProps): ReactElement {
  if (path === null) {
    return <BasesIndex />
  }
  return <BaseFileScreen path={path} view={view} />
}

function BaseFileScreen({ path, view }: { path: string; view: string | null }): ReactElement {
  const name = baseDisplayName(path)
  const state = useBaseDatabase(path, view)
  if (isMobileSurface()) {
    return state.status === 'ready' ? (
      <MobileBaseDatabasePage
        path={path}
        name={name}
        status="ready"
        definition={state.definition}
        database={state.database}
      />
    ) : state.status === 'error' ? (
      <MobileBaseDatabasePage path={path} name={name} status="error" message={state.message} />
    ) : (
      <MobileBaseDatabasePage path={path} name={name} status="loading" />
    )
  }
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={name} description={path} />
      {state.status === 'loading' ? (
        <PageLoading label="Loading base" />
      ) : state.status === 'error' ? (
        <p role="alert" className="py-6 pr-7 pl-12 text-sm text-text-muted">
          Couldn’t open this base: {state.message}
        </p>
      ) : (
        <BaseDatabasePage path={path} definition={state.definition} database={state.database} />
      )}
    </div>
  )
}
