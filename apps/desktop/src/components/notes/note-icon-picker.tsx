import { useState, type ReactElement, type ReactNode } from 'react'
import { IconPickerPanel } from '@/components/icon-picker-panel'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface NoteIconPickerProps {
  /** The stored `icon:` value, or null when the note has none. */
  value: string | null
  onChange: (icon: string | null) => void
  /** Accessible name of the trigger. */
  label: string
  /** What the trigger shows: the current icon, or an "Add icon" label. */
  children: ReactNode
  className?: string | undefined
}

/**
 * The note header's icon control: `children` as the trigger, opening the
 * shared {@link IconPickerPanel}. The pick lands through `onChange`, which
 * writes the note's `icon:` frontmatter.
 */
export function NoteIconPicker({
  value,
  onChange,
  label,
  children,
  className,
}: NoteIconPickerProps): ReactElement {
  const [open, setOpen] = useState(false)

  const pick = (icon: string | null): void => {
    onChange(icon)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={label}
        className={cn('rounded-lg transition-colors hover:bg-surface-hover', className)}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-2">
        <IconPickerPanel value={value} onPick={pick} />
      </PopoverContent>
    </Popover>
  )
}
