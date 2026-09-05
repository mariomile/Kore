import type { ReactElement } from 'react'
import type { OpenTab } from '@reflect/core'
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
  User,
} from '@/components/icons'

interface OpenTabIconProps {
  tab: OpenTab
  className?: string
}

/** Render the semantic icon that identifies a workspace tab. */
export function OpenTabIcon({ tab, className }: OpenTabIconProps): ReactElement {
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
    case 'agents':
      return <User aria-hidden className={className} />
    case 'terminal':
      return <Terminal aria-hidden className={className} />
    case 'browser':
      return <Globe aria-hidden className={className} />
  }
}
