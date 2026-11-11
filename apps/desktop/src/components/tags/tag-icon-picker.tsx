import { useState, type ReactElement } from 'react'
import { IconPickerPanel } from '@/components/icon-picker-panel'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTagSymbolIcons } from '@/lib/tags/tag-symbol-icons'
import { cn } from '@/lib/utils'
import { TagIcon } from './tag-icon'

interface TagIconPickerProps {
  /** The current icon (emoji or `icon:<name>`), or null when the tag has none. */
  value: string | null
  onChange: (icon: string | null) => void
}

/**
 * The tag's icon control: the current icon as the trigger (the `#` glyph
 * while none is set) opening the shared {@link IconPickerPanel}. Stored as
 * `icon:` on the definition note.
 */
export function TagIconPicker({ value, onChange }: TagIconPickerProps): ReactElement {
  const [open, setOpen] = useState(false)
  // Subscribing here (the picker's trigger, not its popover) starts the
  // table fetch when the dialog opens, so it has usually landed by the time
  // the popover does.
  useTagSymbolIcons()

  const pick = (icon: string | null): void => {
    onChange(icon)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Type icon"
        title="Choose an icon"
        className={cn(
          'flex size-8 items-center justify-center rounded-lg border border-input transition-colors hover:bg-surface-hover',
          value === null && 'text-text-muted',
        )}
      >
        <TagIcon icon={value ?? undefined} className="size-4" emojiClassName="text-base" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-2">
        <IconPickerPanel value={value} onPick={pick} />
      </PopoverContent>
    </Popover>
  )
}
