import type { ReactElement, ReactNode } from 'react'
import { cn } from '@/lib/utils'

// One SF Symbol-like, round-stroke set so every primary row shares optical
// size and weight inside the liquid-glass tile.

interface SidebarGlyphProps {
  className?: string | undefined
}

function SidebarGlyph({
  className,
  children,
}: SidebarGlyphProps & { children: ReactNode }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('size-[15px]', className)}
      aria-hidden
    >
      {children}
    </svg>
  )
}

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/** Daily notes — SF Symbol-like pencil. */
export function DailyNotesGlyph({ className }: SidebarGlyphProps): ReactElement {
  return (
    <SidebarGlyph className={className}>
      <path
        d="M14.6 5.15a2 2 0 0 1 2.83 0l1.42 1.42a2 2 0 0 1 0 2.83L9.05 19.2 5.5 20.1l.9-3.55 8.2-11.4Z"
        {...stroke}
      />
      <path d="M13.35 6.4 17.6 10.65" {...stroke} />
    </SidebarGlyph>
  )
}

/** square.and.pencil — New note. */
export function NewNoteGlyph({ className }: SidebarGlyphProps): ReactElement {
  return (
    <SidebarGlyph className={className}>
      <path d="M5.5 8.25v9.25A2 2 0 0 0 7.5 19.5h8.25" {...stroke} />
      <path d="M5.5 8.25A2 2 0 0 1 7.5 6.25h5.1" {...stroke} />
      <path
        d="M13.7 6.05a1.65 1.65 0 0 1 2.33 0l1.12 1.12a1.65 1.65 0 0 1 0 2.33L13.2 13.45l-2.55.7.7-2.55 2.35-5.55Z"
        {...stroke}
      />
    </SidebarGlyph>
  )
}

/** doc.text — All notes. */
export function AllNotesGlyph({ className }: SidebarGlyphProps): ReactElement {
  return (
    <SidebarGlyph className={className}>
      <path
        d="M8 5.5h5.2L17.5 9.8V18a1.7 1.7 0 0 1-1.7 1.7H8A1.7 1.7 0 0 1 6.3 18V7.2A1.7 1.7 0 0 1 8 5.5Z"
        {...stroke}
      />
      <path d="M13 5.7v3.4h3.6" {...stroke} />
      <path d="M9.2 13h5.4M9.2 16h3.6" {...stroke} />
    </SidebarGlyph>
  )
}

/** checklist — Tasks. */
export function TasksGlyph({ className }: SidebarGlyphProps): ReactElement {
  return (
    <SidebarGlyph className={className}>
      <path d="M5.4 8.15 6.85 9.6 9.3 7.15" {...stroke} />
      <path d="M5.4 15.85 6.85 17.3 9.3 14.85" {...stroke} />
      <path d="M12.1 8.4h6.5M12.1 16.1h6.5" {...stroke} />
    </SidebarGlyph>
  )
}

/** bubble.left — Chat. */
export function ChatGlyph({ className }: SidebarGlyphProps): ReactElement {
  return (
    <SidebarGlyph className={className}>
      <path
        d="M6.2 16.35C5.15 15.25 4.5 13.85 4.5 12.3c0-3.45 3.36-6.25 7.5-6.25s7.5 2.8 7.5 6.25-3.36 6.25-7.5 6.25c-1.05 0-2.05-.18-2.95-.5L6.05 18.7v-2.35Z"
        {...stroke}
      />
    </SidebarGlyph>
  )
}

/** person — Agents. */
export function AgentsGlyph({ className }: SidebarGlyphProps): ReactElement {
  return (
    <SidebarGlyph className={className}>
      <circle cx="12" cy="8.15" r="2.55" {...stroke} />
      <path d="M6.7 17.7c.55-2.7 2.55-4.15 5.3-4.15s4.75 1.45 5.3 4.15" {...stroke} />
    </SidebarGlyph>
  )
}

/** chart.bar — Insights. */
export function InsightsGlyph({ className }: SidebarGlyphProps): ReactElement {
  return (
    <SidebarGlyph className={className}>
      <path d="M6.4 17.4V11.1M12 17.4V6.6M17.6 17.4v-4.4" {...stroke} />
    </SidebarGlyph>
  )
}

/** point.3.connected — Graph. */
export function GraphGlyph({ className }: SidebarGlyphProps): ReactElement {
  return (
    <SidebarGlyph className={className}>
      <circle cx="7.1" cy="8.1" r="1.85" {...stroke} />
      <circle cx="16.9" cy="8.1" r="1.85" {...stroke} />
      <circle cx="12" cy="16.35" r="1.85" {...stroke} />
      <path d="M8.7 9.15 10.7 14.7M15.3 9.15 13.3 14.7M8.95 8.1h6.1" {...stroke} />
    </SidebarGlyph>
  )
}
