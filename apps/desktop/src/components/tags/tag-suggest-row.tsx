import type { ReactElement } from 'react'
import { Sparkles } from '@/components/icons'
import { cn } from '@/lib/utils'
import { useSuggestTagSchema } from './use-suggest-tag-schema'

/**
 * The "Suggest with AI" row a tag with no properties offers beside the
 * ready-made schemas: one tap hands the question to the chat
 * ({@link useSuggestTagSchema}). `dialog` is the desktop card's compact row,
 * `sheet` the phone list's tall one. Renders nothing where there is no chat
 * to hand it to.
 */
export function TagSuggestRow({
  tagKey,
  onClose,
  variant,
}: {
  tagKey: string
  onClose: () => void
  variant: 'dialog' | 'sheet'
}): ReactElement | null {
  const suggest = useSuggestTagSchema(tagKey, onClose)
  if (suggest === null) {
    return null
  }
  const sheet = variant === 'sheet'
  return (
    <button
      type="button"
      onClick={suggest}
      className={cn(
        'flex items-center text-left',
        sheet
          ? 'min-h-14 w-full gap-3 border-t border-border px-4 py-2 active:bg-surface-hover'
          : 'gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-active',
      )}
    >
      <Sparkles aria-hidden className={cn('shrink-0 text-primary', sheet ? 'size-5' : 'size-4')} />
      <span className="flex min-w-0 flex-col">
        <span className={sheet ? 'text-base text-primary' : 'text-sm font-medium text-text'}>
          Suggest with AI
        </span>
        <span className="truncate text-xs text-text-muted">
          Chat proposes properties from its notes
        </span>
      </span>
    </button>
  )
}
