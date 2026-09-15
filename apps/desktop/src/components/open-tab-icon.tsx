import type { ReactElement } from 'react'
import { foldTag, type OpenTab } from '@reflect/core'
import { TagIcon } from '@/components/tags/tag-icon'
import { useTagIcons } from '@/hooks/use-tag-icons'
import {
  Chart,
  Chat,
  Checklist,
  Globe,
  Graph,
  Note,
  Pencil,
  Search,
  Terminal,
} from '@/components/icons'

interface OpenTabIconProps {
  tab: OpenTab
  className?: string
}

/**
 * Render the semantic icon that identifies a workspace tab. A tag page tab
 * carries the tag's own icon (or the `#` glyph), the same mark as its
 * sidebar row.
 */
export function OpenTabIcon({ tab, className }: OpenTabIconProps): ReactElement {
  const tagIcons = useTagIcons()
  if (tab.kind === 'surface' && tab.surface === 'allNotes' && tab.filter.kind === 'tag') {
    return <TagIcon icon={tagIcons.get(foldTag(tab.filter.tag))} className={className} />
  }
  if (tab.kind === 'note') {
    return <Note aria-hidden className={className} />
  }
  if (tab.kind === 'chat') {
    return <Chat aria-hidden className={className} />
  }
  switch (tab.surface) {
    case 'daily':
      return <Pencil aria-hidden className={className} />
    case 'allNotes':
      return <Note aria-hidden className={className} />
    case 'search':
      return <Search aria-hidden className={className} />
    case 'tasks':
      return <Checklist aria-hidden className={className} />
    case 'insights':
      return <Chart aria-hidden className={className} />
    case 'graphMap':
      return <Graph aria-hidden className={className} />
    case 'terminal':
      return <Terminal aria-hidden className={className} />
    case 'browser':
      return <Globe aria-hidden className={className} />
  }
}
