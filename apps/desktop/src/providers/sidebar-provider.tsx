import {
  createContext,
  useCallback,
  use,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { haptic } from '@/lib/haptics'

/**
 * Side-panel visibility state, provided once per workspace so the shell
 * (which renders or hides the two sidebar rails) and the command registry
 * (`⌘\` / "Toggle sidebar", `⌘⇧\` / "Toggle context panel") share one source
 * of truth. The rails collapse independently — hide the navigation to write,
 * hide the context rail to read wide, or both for a bare sheet. Session-only
 * by design — a relaunch starts with both expanded.
 */

interface SidebarContextValue {
  /** The left (workspace) rail. */
  collapsed: boolean
  toggleSidebar: () => void
  /** The right (context) rail. */
  contextCollapsed: boolean
  toggleContextSidebar: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function SidebarProvider({ children }: { children: ReactNode }): ReactElement {
  const [collapsed, setCollapsed] = useState(false)
  const [contextCollapsed, setContextCollapsed] = useState(false)
  const toggleSidebar = useCallback(() => {
    haptic('level-change')
    setCollapsed((current) => !current)
  }, [])
  const toggleContextSidebar = useCallback(() => {
    haptic('level-change')
    setContextCollapsed((current) => !current)
  }, [])

  const value = useMemo<SidebarContextValue>(
    () => ({ collapsed, toggleSidebar, contextCollapsed, toggleContextSidebar }),
    [collapsed, toggleSidebar, contextCollapsed, toggleContextSidebar],
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
