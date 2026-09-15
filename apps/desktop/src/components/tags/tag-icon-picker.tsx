import { useState, type ReactElement } from 'react'
import { parseNoteIcon } from '@reflect/core'
import { Sparkles } from '@/components/icons'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/**
 * A short curated set; any other emoji comes through the free input below
 * (the OS emoji palette lands there too).
 */
const SUGGESTED_ICONS = [
  '📁',
  '📚',
  '📖',
  '📝',
  '📌',
  '📅',
  '🗓️',
  '✅',
  '🎯',
  '🚀',
  '💡',
  '🔥',
  '⭐',
  '❤️',
  '🧠',
  '👤',
  '👥',
  '🏢',
  '🤝',
  '💬',
  '📞',
  '✉️',
  '💰',
  '💳',
  '🛒',
  '🧾',
  '🔧',
  '⚙️',
  '🧪',
  '🔬',
  '🎨',
  '🎵',
  '🎬',
  '📷',
  '🌍',
  '✈️',
  '🏠',
  '🍽️',
  '🏃',
  '🌱',
] as const

interface TagIconPickerProps {
  /** The current glyph, or null when the tag has none. */
  value: string | null
  onChange: (icon: string | null) => void
}

const EMOJI_RE = /\p{Extended_Pictographic}/u

/**
 * The first grapheme of `text` when it is an emoji, else null: plain letters
 * never become an icon mid-keystroke.
 */
function firstGlyph(text: string): string | null {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  for (const { segment } of segmenter.segment(text.trim())) {
    const parsed = parseNoteIcon(segment)
    return parsed?.kind === 'emoji' && EMOJI_RE.test(segment) ? parsed.glyph : null
  }
  return null
}

/**
 * The tag's icon control: the current glyph as the trigger, a popover with a
 * suggested grid plus a free field that takes any emoji (typed, pasted, or
 * from the OS palette). Stored as `icon:` on the definition note.
 */
export function TagIconPicker({ value, onChange }: TagIconPickerProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  const pick = (icon: string | null): void => {
    onChange(icon)
    setDraft('')
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Tag icon"
        title="Choose an icon"
        className={cn(
          'flex size-8 items-center justify-center rounded-lg border border-input text-base transition-colors hover:bg-surface-hover',
          value === null && 'text-text-muted',
        )}
      >
        {value ?? <Sparkles aria-hidden className="size-4" />}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-2">
        <div role="group" aria-label="Suggested icons" className="grid grid-cols-8 gap-0.5">
          {SUGGESTED_ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              aria-label={icon}
              aria-pressed={icon === value}
              onClick={() => pick(icon)}
              className={cn(
                'flex size-7 items-center justify-center rounded text-base hover:bg-surface-hover',
                icon === value && 'bg-surface-active',
              )}
            >
              {icon}
            </button>
          ))}
        </div>
        <Input
          aria-label="Any emoji"
          placeholder="Or type any emoji"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            const glyph = firstGlyph(event.target.value)
            if (glyph !== null) {
              pick(glyph)
            }
          }}
        />
        {value !== null ? (
          <button
            type="button"
            onClick={() => pick(null)}
            className="self-start rounded px-1.5 py-0.5 text-xs text-text-muted hover:bg-surface-hover hover:text-text"
          >
            Remove icon
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
