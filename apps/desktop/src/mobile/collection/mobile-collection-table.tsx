import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { Virtualizer } from 'virtua'
import type { CollectionEntry, CollectionValue, TagProperty, TagType } from '@kore/core'
import { CollectionCell } from '@/components/all-notes/collection-cell'
import { Plus } from '@/components/icons'
import { PropertyValueEditor } from '@/components/tags/property-editors'
import { useCommitNoteProperty } from '@/lib/tags/use-commit-note-property'
import { useOpenRelation } from '@/lib/tags/use-open-relation'
import { cn } from '@/lib/utils'
import { mobileColumnWidth } from './mobile-type-view'
import './mobile-collection-table.css'

/** One row's height: a 44pt hit target plus the hairline breathing room. */
export const MOBILE_TABLE_ROW_HEIGHT = 48
/** The column header band. */
const HEADER_HEIGHT = 36
/** The frozen row-number column. */
const NUMBER_WIDTH = 40
/** The frozen title column: wide enough for a short title, narrow enough to leave room. */
const TITLE_WIDTH = 172

interface MobileCollectionTableProps {
  entries: readonly CollectionEntry[]
  /** The schema with hidden columns left out: what the table shows. */
  type: TagType
  /** The type's name, for the table's accessible label. */
  label: string
  onOpen: (path: string) => void
  /** Create a row titled `title`; resolves once it is written. */
  onCreate: (title: string) => Promise<void>
}

/**
 * A type's table on a phone (Craft's collection table): the row number and
 * title stay frozen on the left while the property columns scroll sideways,
 * the header stays pinned while the rows scroll down, and the rows are
 * virtualized so a type with thousands of notes scrolls like ten. Tapping
 * the title opens the note; tapping a cell opens the same per-type editor
 * the Mac's table and the note's properties panel use, so a value means the
 * same thing everywhere. The last row creates a note in place.
 */
export function MobileCollectionTable({
  entries,
  type,
  label,
  onOpen,
  onCreate,
}: MobileCollectionTableProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const commitProperty = useCommitNoteProperty()
  const openRelation = useOpenRelation()
  // Only the tapped cell carries a live editor: a popover per visible cell
  // made every scrolled-in row cost four times a plain one.
  const [activeCell, setActiveCell] = useState<string | null>(null)
  const widths = type.properties.map(mobileColumnWidth)
  const frozenWidth = NUMBER_WIDTH + TITLE_WIDTH
  const totalWidth = frozenWidth + widths.reduce((sum, width) => sum + width, 0)

  return (
    <div
      ref={scrollRef}
      data-base-ui-swipe-ignore
      className="mobile-collection-table min-h-0 flex-1 overflow-auto overscroll-x-contain"
      // The frozen columns cast their edge only once the rest slides under
      // them; toggled on the element so a scroll never re-renders the rows.
      onScroll={(event) => {
        const scrolled = event.currentTarget.scrollLeft > 0
        if (event.currentTarget.hasAttribute('data-scrolled-x') !== scrolled) {
          event.currentTarget.toggleAttribute('data-scrolled-x', scrolled)
        }
      }}
      style={{
        paddingTop: 'var(--mobile-header-height, 0px)',
        paddingBottom: 'var(--mobile-tab-bar-height, env(safe-area-inset-bottom))',
      }}
    >
      <div
        role="table"
        aria-label={label}
        aria-rowcount={entries.length + 1}
        style={{ width: `max(100%, ${totalWidth}px)` }}
      >
        <div
          role="row"
          className="sticky z-20 flex bg-background"
          // The band also paints the strip above it, so rows leaving the top
          // vanish under the glass header instead of peeking between the two.
          style={{
            top: 0,
            height: HEADER_HEIGHT,
            boxShadow: '0 -24px 0 0 var(--color-background)',
          }}
        >
          <HeaderCell frozenLeft={0} width={NUMBER_WIDTH} align="end">
            #
          </HeaderCell>
          <HeaderCell frozenLeft={NUMBER_WIDTH} width={TITLE_WIDTH} edge>
            Title
          </HeaderCell>
          {type.properties.map((property, index) => (
            <HeaderCell key={property.key} width={widths[index] ?? 0}>
              {property.name}
            </HeaderCell>
          ))}
          <div aria-hidden className="flex-1" />
        </div>
        <Virtualizer
          scrollRef={scrollRef}
          data={entries}
          itemSize={MOBILE_TABLE_ROW_HEIGHT}
          startMargin={HEADER_HEIGHT}
          bufferSize={640}
        >
          {(entry, index) => (
            <div
              key={entry.path}
              role="row"
              data-note-path={entry.path}
              className="group flex"
              style={{ height: MOBILE_TABLE_ROW_HEIGHT }}
            >
              <div
                role="cell"
                className="sticky z-10 flex items-center justify-end bg-background pr-2 text-[13px] tabular-nums text-text-muted"
                style={{ left: 0, width: NUMBER_WIDTH, minWidth: NUMBER_WIDTH }}
              >
                {index + 1}
              </div>
              <div
                role="rowheader"
                className="mobile-table-frozen-edge sticky z-10 flex bg-background"
                style={{ left: NUMBER_WIDTH, width: TITLE_WIDTH, minWidth: TITLE_WIDTH }}
              >
                <button
                  type="button"
                  onClick={() => onOpen(entry.path)}
                  className="flex min-w-0 flex-1 items-center px-2 text-left text-[15px] font-medium text-text active:opacity-60"
                >
                  <span className="truncate">{entry.title}</span>
                </button>
              </div>
              {type.properties.map((property, column) => {
                const cellId = `${entry.path}\n${property.key}`
                return (
                  <div
                    key={property.key}
                    role="cell"
                    className="flex items-center px-3"
                    style={{ width: widths[column], minWidth: widths[column] }}
                  >
                    <TableCell
                      property={property}
                      value={entry.properties[property.key]}
                      active={activeCell === cellId}
                      onActivate={() => setActiveCell(cellId)}
                      onCommit={(next) => commitProperty(entry.path, property.key, next)}
                      onOpenRelation={openRelation}
                    />
                  </div>
                )
              })}
              <div aria-hidden className="flex-1" />
            </div>
          )}
        </Virtualizer>
        <NewRow width={frozenWidth} onCreate={onCreate} />
      </div>
    </div>
  )
}

interface TableCellProps {
  property: TagProperty
  value: CollectionValue | undefined
  /** This cell was tapped: it mounts the real editor and opens it. */
  active: boolean
  onActivate: () => void
  onCommit: (value: unknown) => void
  onOpenRelation: (target: string) => void
}

/**
 * One property cell. At rest it is the plain display (cheap to scroll in);
 * the first tap swaps in the shared per-type editor and hands it the same
 * tap, so the popover opens (or the checkbox flips) exactly as if the editor
 * had been there all along.
 */
function TableCell({
  property,
  value,
  active,
  onActivate,
  onCommit,
  onOpenRelation,
}: TableCellProps): ReactElement {
  const cellRef = useRef<HTMLDivElement | null>(null)
  const handedOverRef = useRef(false)
  useEffect(() => {
    if (!active || handedOverRef.current) {
      return
    }
    handedOverRef.current = true
    cellRef.current?.querySelector<HTMLElement>('button')?.click()
  }, [active])
  if (!active) {
    return (
      <button
        type="button"
        aria-label={`Edit ${property.name}`}
        onClick={onActivate}
        className="flex min-h-5 w-full min-w-0 items-center self-stretch text-left focus-visible:outline-none"
      >
        <CollectionCell property={property} value={value} selected={false} />
      </button>
    )
  }
  return (
    <div ref={cellRef} className="flex w-full min-w-0 self-stretch">
      <PropertyValueEditor
        property={property}
        value={value}
        onCommit={onCommit}
        onOpenRelation={onOpenRelation}
      >
        <CollectionCell property={property} value={value} selected={false} />
      </PropertyValueEditor>
    </div>
  )
}

function HeaderCell({
  children,
  width,
  frozenLeft,
  align = 'start',
  edge = false,
}: {
  children: string
  width: number
  /** The sticky left offset for a frozen column; absent for a scrolling one. */
  frozenLeft?: number
  align?: 'start' | 'end'
  /** The last frozen column draws the edge the scrolling columns slide under. */
  edge?: boolean
}): ReactElement {
  const frozen = frozenLeft !== undefined
  return (
    <div
      role="columnheader"
      className={cn(
        'flex items-center truncate text-[12px] font-medium text-text-muted',
        align === 'end' ? 'justify-end pr-2' : frozen ? 'px-2' : 'px-3',
        frozen && 'sticky z-30 bg-background',
        edge && 'mobile-table-frozen-edge',
      )}
      style={{ width, minWidth: width, left: frozenLeft }}
    >
      <span className="truncate">{children}</span>
    </div>
  )
}

/**
 * The table's last row: "New" until tapped, then a title field that creates
 * the note on Return (and on blur, when something was typed). Stays frozen
 * with the titles so it never scrolls out of reach sideways.
 */
function NewRow({
  width,
  onCreate,
}: {
  width: number
  onCreate: (title: string) => Promise<void>
}): ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const busyRef = useRef(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // The field appears because "New" was tapped: take the keyboard at once.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
    }
  }, [editing])

  const submit = async (): Promise<void> => {
    const title = draft.trim()
    if (title === '' || busyRef.current) {
      setEditing(false)
      setDraft('')
      return
    }
    busyRef.current = true
    try {
      await onCreate(title)
      setDraft('')
    } finally {
      busyRef.current = false
    }
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submit()
    } else if (event.key === 'Escape') {
      setDraft('')
      setEditing(false)
    }
  }

  return (
    <div
      role="row"
      className="sticky left-0 flex items-center"
      style={{ height: MOBILE_TABLE_ROW_HEIGHT, width }}
    >
      {editing ? (
        <>
          <span
            aria-hidden
            className="flex shrink-0 justify-end pr-2 text-text-muted"
            style={{ width: NUMBER_WIDTH }}
          >
            <Plus className="size-4" />
          </span>
          <input
            ref={inputRef}
            aria-label="New note title"
            enterKeyHint="done"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => void submit()}
            placeholder="Title"
            className="h-11 min-w-0 flex-1 bg-transparent px-2 text-[15px] font-medium text-text outline-none placeholder:text-text-muted"
          />
        </>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex h-11 flex-1 items-center text-[15px] text-text-muted active:opacity-60"
        >
          <span className="flex shrink-0 justify-end pr-2" style={{ width: NUMBER_WIDTH }}>
            <Plus aria-hidden className="size-4" />
          </span>
          <span className="px-2">New</span>
        </button>
      )}
    </div>
  )
}
