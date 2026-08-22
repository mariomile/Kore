import type { ReactElement } from 'react'
import { useDocumentOutline } from '@/hooks/use-document-outline'
import { cn } from '@/lib/utils'
import { SidebarSection } from './sidebar-section'

/**
 * The open note's headings, as a jump list.
 *
 * The sidebar could already tell you what a note connects *to* — backlinks,
 * unlinked mentions, similar notes — but nothing about its own shape. In a
 * long note that left scrolling as the only way to move around it.
 *
 * Indentation is relative, not absolute: a note whose top level is `##`
 * shouldn't render every entry inset by one step, so depth is measured from
 * the shallowest heading present rather than from `h1`. Capped so a deeply
 * nested run can't indent itself off the panel.
 */
const MAX_INDENT_STEPS = 3

export function NoteOutlineSection(): ReactElement | null {
  const { entries, reveal } = useDocumentOutline()

  // A note with no headings has no outline to show — an empty section would
  // be a permanent piece of furniture in every short note.
  if (entries.length === 0) {
    return null
  }

  const shallowest = Math.min(...entries.map((entry) => entry.level))

  return (
    <SidebarSection storageKey="note-outline" title="Outline">
      <ul>
        {entries.map((entry) => (
          <li key={`${entry.index}-${entry.text}`}>
            <button
              type="button"
              onClick={() => reveal(entry.index)}
              style={{
                paddingLeft: `${0.5 + Math.min(entry.level - shallowest, MAX_INDENT_STEPS) * 0.75}rem`,
              }}
              className={cn(
                'block w-full truncate rounded-md py-1 pr-2 text-left text-[13px] transition-colors duration-100',
                'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                entry.level === shallowest ? 'font-medium text-text' : 'text-text-secondary',
              )}
            >
              {entry.text === '' ? 'Untitled heading' : entry.text}
            </button>
          </li>
        ))}
      </ul>
    </SidebarSection>
  )
}
