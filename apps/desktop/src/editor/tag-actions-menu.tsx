import type { ReactElement } from 'react'
import { Popover, PopoverContent } from '@/components/ui/popover'
import type { TagActionsMenuState } from './use-tag-actions'

interface TagActionsMenuProps {
  /** `null` closes (and unmounts) the menu. */
  state: TagActionsMenuState | null
  onClose: () => void
  onOpenTag: (tag: string) => void
  onConvert: () => void
}

/**
 * The Tana-gesture menu (TDR 0005): opened by clicking a `#tag` inside a
 * daily note, anchored to the click point rather than a fixed trigger
 * element — a zero-size virtual anchor at the originating event's viewport
 * coordinates, the pattern Base UI's popover positioning supports directly.
 */
export function TagActionsMenu({
  state,
  onClose,
  onOpenTag,
  onConvert,
}: TagActionsMenuProps): ReactElement | null {
  if (state === null) {
    return null
  }
  const { tag } = state
  const anchor = { getBoundingClientRect: () => new DOMRect(state.x, state.y, 0, 0) }

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <PopoverContent anchor={anchor} align="start" side="bottom" className="w-64 gap-0.5 p-1">
        <button
          type="button"
          onClick={() => onOpenTag(tag)}
          className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-surface-hover"
        >
          Open #{tag}
        </button>
        <button
          type="button"
          onClick={onConvert}
          className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-surface-hover"
        >
          Turn this line into a #{tag} note
        </button>
      </PopoverContent>
    </Popover>
  )
}
