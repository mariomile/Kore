import { createElement, type ReactElement } from 'react'
import {
  Archive,
  Book,
  Bookmark,
  Bot,
  Calendar,
  Chart,
  Chat,
  Checklist,
  Cloud,
  Flag,
  Folder,
  Graph,
  Hash,
  Home,
  Image,
  Inbox,
  Keyboard,
  Layers,
  Link,
  Lock,
  Microphone,
  Monitor,
  Note,
  Notebook,
  Paperclip,
  Pencil,
  Phone,
  Pin,
  Sparkles,
  Star,
  Sun,
  User,
  type Icon,
  type IconProps,
} from '@/components/icons'

/**
 * The app icons a tag (or any note's `icon:`) can name as `icon:<name>`. The
 * key is the persisted name, so entries are append-only: renaming one
 * orphans every definition that stored it.
 */
export const TAG_SYMBOL_ICONS: Readonly<Record<string, Icon>> = {
  hash: Hash,
  folder: Folder,
  book: Book,
  notebook: Notebook,
  note: Note,
  pencil: Pencil,
  bookmark: Bookmark,
  star: Star,
  flag: Flag,
  pin: Pin,
  checklist: Checklist,
  calendar: Calendar,
  inbox: Inbox,
  archive: Archive,
  layers: Layers,
  graph: Graph,
  chart: Chart,
  user: User,
  chat: Chat,
  phone: Phone,
  link: Link,
  paperclip: Paperclip,
  image: Image,
  microphone: Microphone,
  cloud: Cloud,
  home: Home,
  monitor: Monitor,
  keyboard: Keyboard,
  bot: Bot,
  sparkles: Sparkles,
  sun: Sun,
  lock: Lock,
}

/**
 * Render the symbol behind a stored name, or null for a name this build
 * lacks. A renderer rather than a component lookup: the component identity
 * is fixed in the table, so no component is created during render.
 */
export function renderSymbolIcon(name: string, props: IconProps): ReactElement | null {
  const Glyph = Object.hasOwn(TAG_SYMBOL_ICONS, name) ? TAG_SYMBOL_ICONS[name] : undefined
  return Glyph === undefined ? null : createElement(Glyph, props)
}
