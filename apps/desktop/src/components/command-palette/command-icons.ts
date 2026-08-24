import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CloudUpload,
  Command,
  Contrast,
  Globe,
  Inbox,
  LayoutTemplate,
  NoteDownload,
  NoteEdit,
  NotePlus,
  PanelLeft,
  Pin,
  Refresh,
  Search,
  Settings,
  Shuffle,
  Sparkles,
  Terminal,
  type Icon,
} from '@/components/icons'

/**
 * Palette row icons by command id — a UI-side map, not part of the command
 * contract: the registry stays host-agnostic (CLI and deep links don't render
 * icons), and an unmapped command just gets the generic glyph.
 */
export const COMMAND_ICONS: Record<string, Icon> = {
  'nav.today': CalendarDays,
  'note.new': NoteEdit,
  'browser.open': Globe,
  'nav.terminal': Terminal,
  'capture.quick': Inbox,
  'history.back': ArrowLeft,
  'history.forward': ArrowRight,
  'palette.open': Search,
  'note.togglePin': Pin,
  'note.publishGist': CloudUpload,
  'note.export': NoteDownload,
  'note.random': Shuffle,
  'template.insert': LayoutTemplate,
  'template.new': NotePlus,
  'theme.toggle': Contrast,
  'sidebar.toggle': PanelLeft,
  'settings.open': Settings,
  'semantic.enable': Sparkles,
  'index.rebuild': Refresh,
}

export const FALLBACK_COMMAND_ICON: Icon = Command
