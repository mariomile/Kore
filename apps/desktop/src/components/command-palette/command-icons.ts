import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CloudUpload,
  Command,
  FileDown,
  FilePlus2,
  Inbox,
  LayoutTemplate,
  PanelLeft,
  Pin,
  RefreshCw,
  Search,
  Settings,
  Shuffle,
  Sparkles,
  SquarePen,
  SunMoon,
  type LucideIcon,
} from 'lucide-react'

/**
 * Palette row icons by command id — a UI-side map, not part of the command
 * contract: the registry stays host-agnostic (CLI and deep links don't render
 * icons), and an unmapped command just gets the generic glyph.
 */
export const COMMAND_ICONS: Record<string, LucideIcon> = {
  'nav.today': CalendarDays,
  'note.new': SquarePen,
  'capture.quick': Inbox,
  'history.back': ArrowLeft,
  'history.forward': ArrowRight,
  'palette.open': Search,
  'note.togglePin': Pin,
  'note.publishGist': CloudUpload,
  'note.export': FileDown,
  'note.random': Shuffle,
  'template.insert': LayoutTemplate,
  'template.new': FilePlus2,
  'theme.toggle': SunMoon,
  'sidebar.toggle': PanelLeft,
  'settings.open': Settings,
  'semantic.enable': Sparkles,
  'index.rebuild': RefreshCw,
}

export const FALLBACK_COMMAND_ICON: LucideIcon = Command
