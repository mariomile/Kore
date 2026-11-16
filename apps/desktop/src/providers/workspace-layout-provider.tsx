import {
  createContext,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react'
import { errorMessage, loadWorkspaceLayout, saveWorkspaceLayout, type OpenColumn } from '@kore/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { startOperation } from '@/lib/operations'
import {
  createWorkspaceLayoutStore,
  type LayoutMutation,
  type WorkspaceLayoutStore,
} from '@/lib/workspace-layout-store'

/**
 * The main window's workspace layout (columns, panes, tabs per graph), kept
 * apart from the user settings: it changes on every navigation, and only the
 * pane and tab models read it.
 */

const WorkspaceLayoutContext = createContext<WorkspaceLayoutStore | null>(null)

const NO_COLUMNS: readonly OpenColumn[] = []

function createStore(): WorkspaceLayoutStore {
  return createWorkspaceLayoutStore({
    load: loadWorkspaceLayout,
    save: saveWorkspaceLayout,
    onLoadError: (error) => {
      startOperation('Loading open tabs').fail(errorMessage(error))
    },
    onSaveError: (error) => {
      startOperation('Saving open tabs').fail(errorMessage(error))
    },
  })
}

export function WorkspaceLayoutProvider({ children }: { children: ReactNode }): ReactElement {
  const [store] = useState(createStore)
  const bridgeReady = useBridgeReady()
  useEffect(() => {
    if (bridgeReady) {
      void store.hydrate()
    }
  }, [bridgeReady, store])
  return <WorkspaceLayoutContext value={store}>{children}</WorkspaceLayoutContext>
}

function useStore(): WorkspaceLayoutStore {
  const store = use(WorkspaceLayoutContext)
  if (store === null) {
    throw new Error('workspace layout hooks must be used within a WorkspaceLayoutProvider')
  }
  return store
}

/** One graph's stored columns; re-renders only when that graph's layout changes. */
export function useWorkspaceLayout(root: string | null): readonly OpenColumn[] {
  const store = useStore()
  return useSyncExternalStore(store.subscribe, () =>
    root === null ? NO_COLUMNS : store.columnsOf(root),
  )
}

/** Rewrite one graph's columns (see {@link WorkspaceLayoutStore.update}). */
export function useUpdateWorkspaceLayout(): (root: string, mutate: LayoutMutation) => void {
  return useStore().update
}
