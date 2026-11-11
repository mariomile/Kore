import { useState, type ReactElement } from 'react'
import { parseNoteIcon, symbolIconValue } from '@kore/core'
import { Input } from '@/components/ui/input'
import { useTagSymbolIcons } from '@/lib/tags/tag-symbol-icons'
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

interface IconPickerPanelProps {
  /** The current icon (emoji or `icon:<name>`), or null when there is none. */
  value: string | null
  /** A chosen icon, or null for "Remove icon". */
  onPick: (icon: string | null) => void
}

/**
 * The body of an icon popover, shared by tags and notes: the app's symbol
 * icons with a search, a suggested emoji grid, a free field that takes any
 * emoji (typed, pasted, or from the OS palette), and "Remove icon" while one
 * is set. Values are the `icon:` frontmatter spelling.
 */
export function IconPickerPanel({ value, onPick }: IconPickerPanelProps): ReactElement {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')

  const needle = query.trim().toLowerCase()
  // Until the symbol table lands the grid is empty, but not a failed search.
  const symbolIcons = useTagSymbolIcons()
  const symbols = Object.entries(symbolIcons ?? {}).filter(
    ([name]) => needle === '' || name.includes(needle),
  )

  return (
    <>
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
              onClick={() => onPick(stored)}
              className={cn(
                'flex size-7 items-center justify-center rounded-sm text-text-secondary hover:bg-surface-hover hover:text-text',
                stored === value && 'bg-surface-active text-text',
              )}
            >
              <Glyph aria-hidden className="size-4" />
            </button>
          )
        })}
      </div>
      {symbolIcons !== null && symbols.length === 0 ? (
        <p className="px-1 text-xs text-text-muted">No icon matches.</p>
      ) : null}
      <div role="group" aria-label="Suggested emoji" className="grid grid-cols-9 gap-0.5">
        {SUGGESTED_ICONS.map((icon) => (
          <button
            key={icon}
            type="button"
            aria-label={icon}
            aria-pressed={icon === value}
            onClick={() => onPick(icon)}
            className={cn(
              'flex size-7 items-center justify-center rounded-sm text-base hover:bg-surface-hover',
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
            onPick(glyph)
          }
        }}
      />
      {value !== null ? (
        <button
          type="button"
          onClick={() => onPick(null)}
          className="self-start rounded-sm px-1.5 py-0.5 text-xs text-text-muted hover:bg-surface-hover hover:text-text"
        >
          Remove icon
        </button>
      ) : null}
    </>
  )
}
