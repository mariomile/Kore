import type { ReactElement } from 'react'
import { Check, Folder } from '@/components/icons'
import { cn } from '@/lib/utils'

/**
 * One folder as an iPhone list row, the Files app's shape: a tile with the
 * glyph, the name over a muted detail line, then a check or a trailing mark.
 * Shared by the folder page's subfolder list and the Move to… sheet, so every
 * folder row on the phone is the same height and type.
 */
interface FolderRowProps {
  /** The tile's glyph; a folder unless the row offers something else. */
  icon?: ReactElement
  name: string
  /** The parent folder's path under the name; hidden at the root. */
  detail?: string
  /** The current folder: highlighted and checked. */
  checked?: boolean
  /** What sits at the row's end when it isn't checked (a chevron that drills in). */
  trailing?: ReactElement
  onPress: () => void
}

export function FolderRow({
  icon = <Folder className="size-[18px]" />,
  name,
  detail,
  checked = false,
  trailing,
  onPress,
}: FolderRowProps): ReactElement {
  return (
    <li>
      <button
        type="button"
        onClick={onPress}
        aria-current={checked ? 'true' : undefined}
        className={cn(
          'flex min-h-14 w-full items-center gap-3 rounded-xl px-2 text-left transition-colors active:bg-surface-hover',
          checked && 'bg-surface-hover',
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-text-muted">
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base">{name}</span>
          {detail !== undefined && detail !== '' ? (
            <span className="truncate text-[13px] text-text-muted">{detail}</span>
          ) : null}
        </span>
        {checked ? (
          <Check aria-label="Current folder" className="size-4 shrink-0 text-accent" />
        ) : (
          trailing
        )}
      </button>
    </li>
  )
}
