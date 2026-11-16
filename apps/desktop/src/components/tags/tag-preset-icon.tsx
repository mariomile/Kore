import type { ReactElement } from 'react'
import { Book, Calendar, Chart, Folder, Plus, User, type Icon } from '@/components/icons'

/** The schema presets' row glyphs (kept here so the preset data stays plain). */
const PRESET_ICONS: Record<string, Icon> = {
  project: Folder,
  person: User,
  company: Chart,
  meeting: Calendar,
  reading: Book,
}

/** A schema preset's glyph, or `+` for a preset without one. */
export function TagPresetIcon({
  presetId,
  className,
}: {
  presetId: string
  className?: string
}): ReactElement {
  const Glyph = PRESET_ICONS[presetId] ?? Plus
  return <Glyph aria-hidden className={className} />
}
