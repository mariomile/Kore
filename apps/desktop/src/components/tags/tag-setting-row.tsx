import type { ReactElement, ReactNode } from 'react'
import type { Icon } from '@/components/icons'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

/** A titled group of setting rows in the desktop tag dialog: caption over a soft card. */
export function TagSettingGroup({
  title,
  children,
}: {
  title: string
  children: ReactNode
}): ReactElement {
  return (
    <section className="flex flex-col gap-1.5" aria-label={title}>
      <h4 className="px-1 text-xs font-medium text-text-secondary">{title}</h4>
      <div className="flex flex-col gap-0.5 rounded-lg bg-surface-hover p-2">{children}</div>
    </section>
  )
}

interface TagSettingRowProps {
  icon: Icon
  title: string
  /** One line saying what the setting does, or what it is doing now. */
  description: ReactNode
  /** The phone sheet's tall row inside a grouped list. */
  touch?: boolean
  /** The control, pinned to the trailing edge. */
  children?: ReactNode
}

/**
 * One setting of a tag: what it is and what it does on the left, its control
 * on the right. The desktop dialog and the phone sheet share it so both read
 * the same sentence for the same setting.
 */
export function TagSettingRow({
  icon: Glyph,
  title,
  description,
  touch = false,
  children,
}: TagSettingRowProps): ReactElement {
  return (
    <div
      className={cn(
        'flex items-center',
        touch
          ? 'min-h-14 gap-3 border-b border-border px-4 py-2 last:border-b-0'
          : 'min-h-11 gap-2.5 px-2 py-1',
      )}
    >
      <Glyph aria-hidden className={cn('shrink-0 text-text-muted', touch ? 'size-5' : 'size-4')} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={touch ? 'text-base text-text' : 'text-sm font-medium text-text'}>
          {title}
        </span>
        <span className="text-xs leading-4 text-text-muted">{description}</span>
      </div>
      {children === undefined ? null : <div className="flex shrink-0 items-center">{children}</div>}
    </div>
  )
}

const NONE = 'none'

/**
 * The control of a setting that is one value or none (a template, a folder):
 * a select whose first entry, `noneLabel`, clears it.
 */
export function TagSettingSelect({
  label,
  value,
  noneLabel,
  options,
  onChange,
}: {
  /** The accessible name of the select. */
  label: string
  value: string | null
  noneLabel: string
  options: readonly { value: string; label: string }[]
  onChange: (value: string | null) => void
}): ReactElement {
  return (
    <Select
      value={value ?? NONE}
      items={{
        [NONE]: noneLabel,
        ...Object.fromEntries(options.map((option) => [option.value, option.label])),
      }}
      onValueChange={(next) => {
        if (typeof next === 'string') {
          onChange(next === NONE ? null : next)
        }
      }}
    >
      <SelectTrigger aria-label={label} className="max-w-52 min-w-32">
        <SelectValue placeholder={noneLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
