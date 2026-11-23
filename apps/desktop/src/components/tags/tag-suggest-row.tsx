import type { ReactElement } from 'react'
import { Sparkles } from '@/components/icons'
import { cn } from '@/lib/utils'

/** The row's classes per layout: the desktop card's compact row, the phone list's tall one. */
const VARIANTS = {
  dialog: {
    row: 'gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-active',
    icon: 'size-4',
    label: 'text-sm font-medium text-text',
  },
  sheet: {
    row: 'min-h-14 w-full gap-3 border-t border-border px-4 py-2 active:bg-surface-hover',
    icon: 'size-5',
    label: 'text-base text-primary',
  },
} as const

/**
 * The "Suggest with AI" row a tag with no properties offers beside the
 * ready-made schemas: one tap hands the question to the chat (see
 * `useSuggestTagSchema`, which the owning surface calls).
 */
export function TagSuggestRow({
  variant,
  onSuggest,
}: {
  variant: keyof typeof VARIANTS
  onSuggest: () => void
}): ReactElement {
  const classes = VARIANTS[variant]
  return (
    <button
      type="button"
      onClick={onSuggest}
      className={cn('flex items-center text-left', classes.row)}
    >
      <Sparkles aria-hidden className={cn('shrink-0 text-primary', classes.icon)} />
      <span className="flex min-w-0 flex-col">
        <span className={classes.label}>Suggest with AI</span>
        <span className="truncate text-xs text-text-muted">
          Chat proposes properties from its notes
        </span>
      </span>
    </button>
  )
}
