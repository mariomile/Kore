import type { ReactElement } from 'react'
import { Undo } from '@/components/icons'
import { cn } from '@/lib/utils'

/** What deleting a stored property does to the notes: said next to the button. */
export const DELETE_PROPERTY_HINT =
  'Notes keep the values they stored, in their frontmatter. Nothing changes until you save.'

interface RemovedPropertyNoticeProps {
  /** The deleted property's name ('' for one never named). */
  name: string
  onUndo: () => void
  /** Row height, inset and type size: the Mac nav and the phone list differ. */
  className?: string
}

/**
 * The line left where a property was just deleted from the type settings:
 * what went, and the way back. Shared by the Mac nav and the iPhone list.
 */
export function RemovedPropertyNotice({
  name,
  onUndo,
  className = '',
}: RemovedPropertyNoticeProps): ReactElement {
  return (
    <div role="status" className={cn('flex items-center gap-2 text-text-muted', className)}>
      <span className="min-w-0 flex-1 truncate">{name || 'Property'} deleted</span>
      <button
        type="button"
        onClick={onUndo}
        className="flex h-full shrink-0 items-center gap-1 rounded-md px-2 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text"
      >
        <Undo aria-hidden className="size-3.5" />
        Undo
      </button>
    </div>
  )
}
