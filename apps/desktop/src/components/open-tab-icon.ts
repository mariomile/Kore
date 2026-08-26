import type { OpenTab, WorkspaceSurface } from '@reflect/core'
import {
  Chart,
  Chat,
  Checklist,
  Globe,
  Graph,
  Note,
  Pencil,
  Search,
  Settings,
  Terminal,
  User,
  type Icon,
} from '@/components/icons'

const SURFACE_ICON: Record<WorkspaceSurface, Icon> = {
  daily: Pencil,
  allNotes: Note,
  search: Search,
  tasks: Checklist,
  insights: Chart,
  graphMap: Graph,
  agents: User,
  settings: Settings,
  terminal: Terminal,
  browser: Globe,
}

/** The semantic icon that identifies a workspace tab. */
export function iconForOpenTab(tab: OpenTab): Icon {
  switch (tab.kind) {
    case 'note':
      return Note
    case 'chat':
      return Chat
    case 'surface':
      return SURFACE_ICON[tab.surface]
  }
}
