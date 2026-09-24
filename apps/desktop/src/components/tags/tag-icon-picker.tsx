import { useState, type ReactElement } from 'react'
import { parseNoteIcon, symbolIconValue } from '@reflect/core'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { TAG_SYMBOL_ICONS } from '@/lib/tags/tag-symbol-icons'
import { cn } from '@/lib/utils'
import { TagIcon } from './tag-icon'

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
  /** The current icon (emoji or `icon:<name>`), or null when the tag has none. */
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
 * The tag's icon control: the current icon as the trigger (the `#` glyph
 * while none is set), a popover with the app's symbol icons, a suggested
 * emoji grid, and a free field that takes any emoji (typed, pasted, or from
 * the OS palette). Stored as `icon:` on the definition note.
 */
export function TagIconPicker({ value, onChange }: TagIconPickerProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')

  const pick = (icon: string | null): void => {
    onChange(icon)
    setDraft('')
    setQuery('')
    setOpen(false)
  }

  const needle = query.trim().toLowerCase()
  const symbols = Object.entries(TAG_SYMBOL_ICONS).filter(
    ([name]) => needle === '' || name.includes(needle),
  )

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
        <Input
          aria-label="Search icons"
          placeholder="Search icons"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div
          role="group"
          aria-label="Symbol icons"
          className="grid max-h-40 grid-cols-9 gap-0.5 overflow-y-auto"
        >
          {symbols.map(([name, Glyph]) => {
            const stored = symbolIconValue(name)
            return (
              <button
                key={name}
                type="button"
                aria-label={name}
                title={name}
                aria-pressed={stored === value}
                onClick={() => pick(stored)}
                className={cn(
                  'flex size-7 items-center justify-center rounded text-text-secondary hover:bg-surface-hover hover:text-text',
                  stored === value && 'bg-surface-active text-text',
                )}
              >
                <Glyph aria-hidden className="size-4" />
              </button>
            )
          })}
        </div>
        {symbols.length === 0 ? (
          <p className="px-1 text-xs text-text-muted">No icon matches.</p>
        ) : null}
        <div role="group" aria-label="Suggested emoji" className="grid grid-cols-9 gap-0.5">
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
