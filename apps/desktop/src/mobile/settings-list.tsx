import { useRef, type ReactElement, type ReactNode } from 'react'
import { Check, ChevronRight, type Icon } from '@/components/icons'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useSlidingIndicator } from '@/mobile/use-sliding-indicator'

/**
 * iOS-style inset-grouped list primitives for the mobile settings screens:
 * rounded section cards with hairline row separators, a small muted header
 * above and an explanatory footer below (the platform's Settings idiom).
 * Rows come in the standard shapes — static value, disclosure (chevron),
 * switch, inline segmented choice, action, and checkmark selection.
 */

const ROW_CLASS = 'flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-[15px]'
const PRESSABLE_ROW_CLASS = cn(
  ROW_CLASS,
  'text-left transition-colors active:bg-secondary/70 disabled:opacity-50',
)

interface SettingsGroupProps {
  /** Small muted caption above the card (iOS section header). */
  header?: string
  /** Explanatory text below the card (iOS section footer). */
  footer?: string | null
  /** Optional id for associating the footer with a control in the group. */
  footerId?: string
  children: ReactNode
}

/** One inset-grouped section: header caption, rounded card, footer text. */
export function SettingsGroup({
  header,
  footer,
  footerId,
  children,
}: SettingsGroupProps): ReactElement {
  return (
    <section className="flex flex-col">
      {header !== undefined ? (
        <h2 className="px-4 pb-1.5 text-[13px] font-medium text-text-muted">{header}</h2>
      ) : null}
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {children}
      </div>
      {footer != null ? (
        <p id={footerId} className="px-4 pt-1.5 text-[13px] text-text-muted">
          {footer}
        </p>
      ) : null}
    </section>
  )
}

/** A static label / value pair (version, note count, …). */
export function SettingsValueRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className={ROW_CLASS}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-text-muted tabular-nums">{value}</span>
    </div>
  )
}

interface SettingsNavRowProps {
  label: string
  /** Muted current value shown before the chevron. */
  value?: string | undefined
  onPress: () => void
  disabled?: boolean
}

/** A disclosure row: tapping navigates deeper (trailing chevron). */
export function SettingsNavRow({
  label,
  value,
  onPress,
  disabled,
}: SettingsNavRowProps): ReactElement {
  return (
    <button type="button" className={PRESSABLE_ROW_CLASS} onClick={onPress} disabled={disabled}>
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {value !== undefined ? <span className="shrink-0 text-text-muted">{value}</span> : null}
      <ChevronRight aria-hidden className="size-4 shrink-0 text-text-muted" />
    </button>
  )
}

interface SettingsSwitchRowProps {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Id of explanatory copy announced after the switch label. */
  descriptionId?: string
}

/** A toggle row. The whole row is the label, so tapping anywhere flips it. */
export function SettingsSwitchRow({
  label,
  checked,
  onCheckedChange,
  descriptionId,
}: SettingsSwitchRowProps): ReactElement {
  return (
    <label className={ROW_CLASS}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Switch
        aria-describedby={descriptionId}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </label>
  )
}

export interface SegmentedOption<Value extends string> {
  value: Value
  label: string
}

interface SettingsSegmentedRowProps<Value extends string> {
  label: string
  value: Value
  options: readonly SegmentedOption<Value>[]
  onChange: (value: Value) => void
}

/** A row with an inline segmented control for a small closed choice. */
export function SettingsSegmentedRow<Value extends string>({
  label,
  value,
  options,
  onChange,
}: SettingsSegmentedRowProps<Value>): ReactElement {
  const controlRef = useRef<HTMLDivElement | null>(null)
  const indicatorRef = useRef<HTMLSpanElement | null>(null)

  useSlidingIndicator(controlRef, indicatorRef, value)

  return (
    <div className={cn(ROW_CLASS, 'justify-between')}>
      <span className="min-w-0 truncate">{label}</span>
      {/* The one segmented-control recipe (shared with All notes' list/grid
          toggle): a fully-round track with a round floating thumb. */}
      <div
        ref={controlRef}
        role="radiogroup"
        aria-label={label}
        className="relative flex shrink-0 items-center gap-0.5 rounded-full bg-surface-hover p-0.5"
      >
        <span
          ref={indicatorRef}
          data-sliding-indicator
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 z-10 rounded-full bg-surface opacity-0 shadow-sm transition-[transform,width,height,opacity] duration-200 ease-swift motion-reduce:transition-none"
        />
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              data-sliding-value={option.value}
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                'relative z-20 h-7 rounded-full px-3 text-[13px] font-medium transition-colors duration-150 motion-reduce:transition-none',
                selected ? 'text-text' : 'text-text-muted',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface SettingsChipsRowProps<Value extends string> {
  label: string
  value: Value
  options: readonly SegmentedOption<Value>[]
  onChange: (value: Value) => void
}

/**
 * A row whose choice wraps onto its own line as chips — for closed choices
 * too wide for the inline segmented control (the six themes). Same visual
 * language as the segmented row, just wrapping.
 */
export function SettingsChipsRow<Value extends string>({
  label,
  value,
  options,
  onChange,
}: SettingsChipsRowProps<Value>): ReactElement {
  return (
    <div className={cn(ROW_CLASS, 'flex-col items-stretch gap-2')}>
      <span className="min-w-0 truncate">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors',
                selected
                  ? 'border-accent bg-accent-soft text-accent-soft-text'
                  : 'border-border text-text-muted',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export interface SwatchOption<Value extends string> {
  value: Value
  label: string
  /** The dot's fill (a CSS color). */
  color: string
}

/** A row of color-dot radios (the accent color picker). */
export function SettingsSwatchRow<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: Value
  options: readonly SwatchOption<Value>[]
  onChange: (value: Value) => void
}): ReactElement {
  return (
    <div className={cn(ROW_CLASS, 'flex-col items-stretch gap-2')}>
      <span className="min-w-0 truncate">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={option.label}
              title={option.label}
              onClick={() => onChange(option.value)}
              className={cn(
                'flex size-8 items-center justify-center rounded-full border transition-colors',
                selected ? 'border-text' : 'border-transparent',
              )}
            >
              <span
                aria-hidden
                className="size-5 rounded-full"
                style={{ background: option.color }}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface SettingsActionRowProps {
  label: string
  onPress: () => void
  /** `destructive` renders the label in the destructive color (iOS red row). */
  tone?: 'default' | 'destructive'
  icon?: Icon
  disabled?: boolean
  /** Replaces the icon with a spinner and disables the row. */
  pending?: boolean
}

/** A tappable action row (disconnect, create, …). */
export function SettingsActionRow({
  label,
  onPress,
  tone = 'default',
  icon: Icon,
  disabled,
  pending,
}: SettingsActionRowProps): ReactElement {
  return (
    <button
      type="button"
      className={cn(
        PRESSABLE_ROW_CLASS,
        tone === 'destructive' ? 'text-destructive' : 'text-primary',
      )}
      onClick={onPress}
      disabled={disabled === true || pending === true}
    >
      {pending === true ? (
        <Spinner />
      ) : Icon !== undefined ? (
        <Icon aria-hidden className="size-4 shrink-0" />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

interface SettingsSelectRowProps {
  label: string
  /** Trailing checkmark — the row is the current choice. */
  selected: boolean
  onPress: () => void
  /** A switch to this row is in flight — show a spinner in the check slot. */
  pending?: boolean
  disabled?: boolean
}

/** A checkmark-selection row (the iOS single-choice list idiom). */
export function SettingsSelectRow({
  label,
  selected,
  onPress,
  pending,
  disabled,
}: SettingsSelectRowProps): ReactElement {
  return (
    <button
      type="button"
      className={PRESSABLE_ROW_CLASS}
      onClick={onPress}
      disabled={disabled}
      aria-current={selected ? 'true' : undefined}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {pending === true ? (
        <Spinner />
      ) : selected ? (
        <Check aria-hidden className="size-4 shrink-0 text-primary" />
      ) : null}
    </button>
  )
}
