import type { TagPropertyType } from '@reflect/core'
import {
  ArrowUturnRight,
  Calculator,
  Calendar,
  CalendarClock,
  Chart,
  CheckCircle,
  ChevronUpDown,
  Flag,
  Graph,
  Hash,
  History,
  Inbox,
  Link,
  List,
  Paperclip,
  Pencil,
  Phone,
  Star,
  User,
  WikiLink,
  type Icon,
} from '@/components/icons'

/**
 * One glyph per property type, so a type reads at a glance: the schema
 * dialog's type picker and the note's field labels draw the same one.
 */
export const PROPERTY_TYPE_ICONS: Record<TagPropertyType, Icon> = {
  text: Pencil,
  number: Hash,
  checkbox: CheckCircle,
  date: Calendar,
  created: CalendarClock,
  updated: History,
  select: ChevronUpDown,
  multiselect: List,
  url: Link,
  relation: WikiLink,
  relations: Graph,
  person: User,
  status: Flag,
  files: Paperclip,
  email: Inbox,
  phone: Phone,
  rating: Star,
  formula: Calculator,
  rollup: Chart,
  reverse: ArrowUturnRight,
}
