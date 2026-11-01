import {
  createContext,
  useCallback,
  use,
  useMemo,
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
  toggleContextSidebar: () => void
  /** The panels the context rail's "+" added as tabs, in the order opened. */
  openedPanels: readonly ContextPanel[]
  setOpenedPanels: (panels: readonly ContextPanel[]) => void
  /** The context rail's selected tab. */
  activePanel: ContextPanel
  setActivePanel: (panel: ContextPanel) => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function SidebarProvider({ children }: { children: ReactNode }): ReactElement {
  const [collapsed, setCollapsed] = useState(false)
  const [contextCollapsed, setContextCollapsed] = useState(false)
  const [openedPanels, setOpenedPanels] = useState<readonly ContextPanel[]>([])
  const [activePanel, setActivePanel] = useState<ContextPanel>(DEFAULT_CONTEXT_PANEL)
  const toggleSidebar = useCallback(() => {
    haptic('level-change')
    setCollapsed((current) => !current)
  }, [])
  const toggleContextSidebar = useCallback(() => {
    haptic('level-change')
    setContextCollapsed((current) => !current)
  }, [])

  const value = useMemo<SidebarContextValue>(
    () => ({
      collapsed,
      toggleSidebar,
      contextCollapsed,
      toggleContextSidebar,
      openedPanels,
      setOpenedPanels,
      activePanel,
      setActivePanel,
    }),
    [collapsed, toggleSidebar, contextCollapsed, toggleContextSidebar, openedPanels, activePanel],
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
