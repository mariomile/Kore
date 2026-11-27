import { useState, type ReactElement, type ReactNode } from 'react'
import { IconPickerPanel } from '@/components/icon-picker-panel'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { HintedTrigger } from './hinted-trigger'
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
  /** A tooltip naming the control, for an icon-only trigger. */
  hint?: string | undefined
  /** Which edge of the trigger the panel lines up with. */
  align?: 'start' | 'end'
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
  hint,
  align = 'start',
}: NoteIconPickerProps): ReactElement {
  const [open, setOpen] = useState(false)

  const pick = (icon: string | null): void => {
    onChange(icon)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <HintedTrigger hint={hint}>
        <PopoverTrigger
          aria-label={label}
          className={cn('rounded-lg transition-colors hover:bg-surface-hover', className)}
        >
          {children}
        </PopoverTrigger>
      </HintedTrigger>
      <PopoverContent align={align} className="w-72 gap-2">
        <IconPickerPanel value={value} onPick={pick} />
      </PopoverContent>
    </Popover>
  )
}
