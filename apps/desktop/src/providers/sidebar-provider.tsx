import {
  createContext,
  useCallback,
  use,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import {
  DEFAULT_CONTEXT_PANEL,
  type ContextPanel,
} from '@/components/context-sidebar/context-panel'
import { haptic } from '@/lib/haptics'

/**
 * Side-panel visibility state, provided once per workspace so the shell
 * (which renders or hides the two sidebar rails) and the command registry
 * (`⌘\` / "Toggle sidebar", `⌘⇧\` / "Toggle context panel") share one source
 * of truth. The rails collapse independently — hide the navigation to write,
 * hide the context rail to read wide, or both for a bare sheet. The context
 * rail's panel tabs live here too: the shell has to know whether the rail
 * carries anything before it reserves room for it. Session-only by design —
 * a relaunch starts with both expanded and the rail on Details alone.
 */

interface SidebarContextValue {
  /** The left (workspace) rail. */
  collapsed: boolean
  toggleSidebar: () => void
  /** The right (context) rail. */
  contextCollapsed: boolean
  /** Flips the context rail; does nothing on a route where the shell hides it. */
  toggleContextSidebar: () => void
  /**
   * The shell reports whether the current route shows the context rail at
   * all. Where it does not (Graph, Tasks, …) there is nothing to toggle, so
   * `⌘⇧\` must not flip a flag the user cannot see and find inverted on the
   * next note.
   */
  setContextRailAvailable: (available: boolean) => void
  /** The context rail's tabs: what the "+" opened, and which one is selected. */
  contextPanels: ContextPanels
  /** Show a panel, giving it a tab first when the "+" has not opened it yet. */
  openContextPanel: (panel: ContextPanel) => void
  /**
   * Take a panel's tab off the rail and select `next`: the caller knows which
   * tab the band shows afterwards, which is what the choice has to record.
   */
  closeContextPanel: (panel: ContextPanel, next: ContextPanel) => void
}

/** The context rail's tab state, updated as one value so it is never half-applied. */
export interface ContextPanels {
  /** The panels the "+" added as tabs, in the order opened. */
  readonly opened: readonly ContextPanel[]
  /** The selected tab; it may name a panel the current route does not show. */
  readonly active: ContextPanel
}

const INITIAL_CONTEXT_PANELS: ContextPanels = { opened: [], active: DEFAULT_CONTEXT_PANEL }

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function SidebarProvider({ children }: { children: ReactNode }): ReactElement {
  const [collapsed, setCollapsed] = useState(false)
  const [contextCollapsed, setContextCollapsed] = useState(false)
  const [contextPanels, setContextPanels] = useState<ContextPanels>(INITIAL_CONTEXT_PANELS)
  const toggleSidebar = useCallback(() => {
    haptic('level-change')
    setCollapsed((current) => !current)
  }, [])
  // A ref, not state: availability only gates the toggle, it never renders.
  const contextRailAvailable = useRef(true)
  const setContextRailAvailable = useCallback((available: boolean) => {
    contextRailAvailable.current = available
  }, [])
  const toggleContextSidebar = useCallback(() => {
    if (!contextRailAvailable.current) {
      return
    }
    haptic('level-change')
    setContextCollapsed((current) => !current)
  }, [])
  const openContextPanel = useCallback((panel: ContextPanel) => {
    setContextPanels(({ opened }) => ({
      // Details is the rail's own tab, not one the "+" adds: it never joins
      // `opened`, which only counts panels that keep the rail up on their own.
      opened:
        panel === DEFAULT_CONTEXT_PANEL || opened.includes(panel) ? opened : [...opened, panel],
      active: panel,
    }))
  }, [])
  const closeContextPanel = useCallback((panel: ContextPanel, next: ContextPanel) => {
    setContextPanels(({ opened }) => ({
      opened: opened.filter((entry) => entry !== panel),
      active: next,
    }))
  }, [])

  const value = useMemo<SidebarContextValue>(
    () => ({
      collapsed,
      toggleSidebar,
      contextCollapsed,
      toggleContextSidebar,
      setContextRailAvailable,
      contextPanels,
      openContextPanel,
      closeContextPanel,
    }),
    [
      collapsed,
      toggleSidebar,
      contextCollapsed,
      toggleContextSidebar,
      setContextRailAvailable,
      contextPanels,
      openContextPanel,
      closeContextPanel,
    ],
  )
  return <SidebarContext value={value}>{children}</SidebarContext>
}

/** Access side-panel visibility + the toggles. Use within a SidebarProvider. */
export function useSidebar(): SidebarContextValue {
  const context = use(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider')
  }
  return context
}
