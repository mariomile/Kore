import { useState, type ReactElement, type ReactNode } from 'react'
import {
  baseNewNotePrefillForGroup,
  type BaseCell,
  type BaseColumn,
  type BaseResultGroup,
  type BaseResultRow,
  type BaseViewResult,
} from '@reflect/core'
import { cn } from '@/lib/utils'
import { BaseCellEditor } from './base-cell-editor'
import { BaseNewRow } from './base-new-row'
import type { BaseCreateHandler } from './use-create-base-note'

/** Write `value` to the note's frontmatter `key`; `undefined` clears it. */
export type BaseEditHandler = (path: string, key: string, value: unknown) => void

interface BaseViewContentProps {
  result: BaseViewResult
  onOpenNote: (path: string) => void
  /** Embedded in a note: tighter padding, no stand-in notice. */
  compact?: boolean
  /** Edits note properties in place; without it the view is read-only. */
  onEdit?: BaseEditHandler
  /** Adds notes from a table or board ("+ New"); without it no row can be added. */
  onCreate?: BaseCreateHandler
}

/**
 * One base view: a table, cards, a list or a board (a grouped plugin
 * `kanban`), with `groupBy` shown as sections. Every note title and linked
 * value opens its note. With `onEdit`, table cells holding a note property
 * edit in place and board cards move between lanes; both write the note's
 * frontmatter, never the `.base` file. With `onCreate`, a table (each
 * grouped section) and every board lane end in a "+ New" line whose note
 * starts with what the view's filters and the lane imply.
 */
export function BaseViewContent({
  result,
  onOpenNote,
  compact = false,
  onEdit,
  onCreate,
}: BaseViewContentProps): ReactElement {
  const gutter = compact ? 'px-0' : 'px-12'
  const canCreate =
    onCreate !== undefined && (result.layout === 'table' || result.layout === 'board')
  const createIn = (dropValue: BaseResultGroup['dropValue']) => (title: string) =>
    onCreate!(title, baseNewNotePrefillForGroup(result.newNote, result.groupEditKey, dropValue))
  if (result.rows.length === 0) {
    return (
      <div className={gutter}>
        <p className="py-6 text-sm text-text-muted">No notes match this view.</p>
        {canCreate ? <BaseNewRow onCreate={createIn(undefined)} /> : null}
      </div>
    )
  }
  const notice =
    result.approximated && !compact ? (
      <p className={cn('pb-3 text-xs text-text-muted', gutter)}>
        “{result.type}” is an Obsidian plugin view. Kore shows it as a {result.layout}.
      </p>
    ) : null
  const more =
    result.total > result.rows.length ? (
      <p className={cn('pt-2 text-xs text-text-muted', gutter)}>
        Showing {result.rows.length} of {result.total}.
      </p>
    ) : null

  if (result.layout === 'board' && result.groups !== null) {
    return (
      <div>
        {notice}
        <BaseBoard
          groups={result.groups}
          columns={result.columns}
          gutter={gutter}
          onOpenNote={onOpenNote}
          onCreateIn={canCreate ? createIn : undefined}
          onMove={
            onEdit === undefined || result.groupEditKey === null
              ? undefined
              : (path, value) => {
                  onEdit(path, result.groupEditKey!, value ?? undefined)
                }
          }
        />
      </div>
    )
  }

  const sections =
    result.groups === null
      ? [{ key: null, rows: result.rows, dropValue: undefined }]
      : result.groups.map(({ key, rows, dropValue }) => ({ key, rows, dropValue }))
  return (
    <div>
      {notice}
      {sections.map((section) => (
        <section key={section.key ?? '__all'} className="pb-4">
          {section.key !== null ? (
            <h3 className={cn('pb-1.5 text-xs font-semibold text-text-secondary', gutter)}>
              {section.key === '' ? 'None' : section.key}
              <span className="ml-1.5 font-normal tabular-nums text-text-muted">
                {section.rows.length}
              </span>
            </h3>
          ) : null}
          <div className={gutter}>
            <BaseRows
              layout={result.layout}
              rows={section.rows}
              columns={result.columns}
              onOpenNote={onOpenNote}
              onEdit={onEdit}
            />
            {canCreate ? (
              <BaseNewRow
                onCreate={createIn(section.dropValue)}
                label={sectionLabel(section.key)}
              />
            ) : null}
          </div>
        </section>
      ))}
      {more}
    </div>
  )
}

interface BaseBoardProps {
  groups: readonly BaseResultGroup[]
  columns: readonly BaseColumn[]
  gutter: string
  onOpenNote: (path: string) => void
  /** Move a card to a lane by writing the lane's value; absent when read-only. */
  onMove: ((path: string, value: BaseResultGroup['dropValue']) => void) | undefined
  /** The "+ New" handler for a lane's value; absent when notes can't be added. */
  onCreateIn:
    | ((dropValue: BaseResultGroup['dropValue']) => (title: string) => Promise<boolean>)
    | undefined
}

function BaseBoard({
  groups,
  columns,
  gutter,
  onOpenNote,
  onMove,
  onCreateIn,
}: BaseBoardProps): ReactElement {
  const [dragging, setDragging] = useState<{ path: string; from: string } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  return (
    <div className={cn('flex items-start gap-3 overflow-x-auto pb-4', gutter)}>
      {groups.map((group) => {
        const label = group.key === '' ? 'None' : group.key
        const accepts =
          onMove !== undefined &&
          group.dropValue !== undefined &&
          dragging !== null &&
          dragging.from !== group.key
        return (
          <section
            key={group.key}
            aria-label={label}
            onDragOver={(event) => {
              if (accepts) {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setOver(group.key)
              }
            }}
            onDragLeave={() => {
              setOver((current) => (current === group.key ? null : current))
            }}
            onDrop={(event) => {
              event.preventDefault()
              if (accepts) {
                onMove(dragging.path, group.dropValue)
              }
              setDragging(null)
              setOver(null)
            }}
            className={cn(
              'flex w-64 flex-none flex-col rounded-xl bg-surface-sunken p-2',
              over === group.key && accepts && 'ring-1 ring-accent',
            )}
          >
            <header className="flex items-center gap-1.5 px-1.5 pb-2">
              <h3 className="min-w-0 flex-1 truncate text-xs font-medium text-text-secondary">
                {label}
              </h3>
              <span className="text-xs tabular-nums text-text-muted">{group.rows.length}</span>
            </header>
            <div className="flex flex-col gap-1.5">
              {group.rows.map((row) => (
                <BaseCard
                  key={row.path}
                  row={row}
                  columns={columns}
                  onOpenNote={onOpenNote}
                  dragging={dragging?.path === row.path}
                  onDragStart={
                    onMove === undefined
                      ? undefined
                      : () => {
                          setDragging({ path: row.path, from: group.key })
                        }
                  }
                  onDragEnd={() => {
                    setDragging(null)
                    setOver(null)
                  }}
                />
              ))}
            </div>
            {onCreateIn !== undefined ? (
              <BaseNewRow
                onCreate={onCreateIn(group.dropValue)}
                label={label}
                className="mt-1 px-1.5"
              />
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

interface BaseRowsProps {
  layout: BaseViewResult['layout']
  rows: readonly BaseResultRow[]
  columns: readonly BaseColumn[]
  onOpenNote: (path: string) => void
  onEdit: BaseEditHandler | undefined
}

function BaseRows({ layout, rows, columns, onOpenNote, onEdit }: BaseRowsProps): ReactElement {
  if (layout === 'cards' || layout === 'board') {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">
        {rows.map((row) => (
          <BaseCard key={row.path} row={row} columns={columns} onOpenNote={onOpenNote} />
        ))}
      </div>
    )
  }
  if (layout === 'list') {
    return (
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.path} className="flex min-w-0 items-baseline gap-2 py-1 text-[13px]">
            <NoteButton path={row.path} title={row.title} onOpenNote={onOpenNote} />
            <span className="min-w-0 truncate text-text-muted">
              {row.cells
                .filter((_, index) => !isTitleColumn(columns[index]))
                .map((cell) => cell.text)
                .filter((text) => text !== '')
                .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className="whitespace-nowrap py-1.5 pr-4 text-xs font-medium text-text-muted"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path} className="border-b border-border/60 hover:bg-surface-hover">
              {row.cells.map((cell, index) => {
                const column = columns[index]
                const key = column?.editKey ?? null
                return (
                  <td key={column?.id ?? index} className="max-w-80 truncate py-1.5 pr-4 align-top">
                    {onEdit !== undefined && key !== null && cell.edit !== null ? (
                      <BaseCellEditor
                        edit={cell.edit}
                        label={`${column?.label ?? key} of ${row.title}`}
                        onCommit={(value) => {
                          onEdit(row.path, key, value)
                        }}
                      >
                        <CellValue cell={cell} onOpenNote={onOpenNote} />
                      </BaseCellEditor>
                    ) : (
                      <CellValue cell={cell} onOpenNote={onOpenNote} />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function sectionLabel(key: string | null): string | undefined {
  return key === null ? undefined : key === '' ? 'None' : key
}

function isTitleColumn(column: BaseColumn | undefined): boolean {
  return column?.id === 'file.name' || column?.id === 'file.basename'
}

interface BaseCardProps {
  row: BaseResultRow
  columns: readonly BaseColumn[]
  onOpenNote: (path: string) => void
  /** Makes the card draggable (a board whose lanes take drops). */
  onDragStart?: (() => void) | undefined
  onDragEnd?: () => void
  dragging?: boolean
}

function BaseCard({
  row,
  columns,
  onOpenNote,
  onDragStart,
  onDragEnd,
  dragging = false,
}: BaseCardProps): ReactElement {
  const details = row.cells.flatMap((cell, index) => {
    const column = columns[index]
    return column === undefined ||
      isTitleColumn(column) ||
      (cell.text === '' && cell.error === null)
      ? []
      : [{ column, cell }]
  })
  return (
    <article
      data-note-path={row.path}
      draggable={onDragStart !== undefined}
      onDragStart={
        onDragStart === undefined
          ? undefined
          : (event) => {
              event.dataTransfer.setData('text/plain', row.path)
              event.dataTransfer.effectAllowed = 'move'
              onDragStart()
            }
      }
      onDragEnd={onDragEnd}
      className={cn(
        'rounded-lg border border-border bg-surface px-3 py-2',
        onDragStart !== undefined && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-50',
      )}
    >
      <NoteButton
        path={row.path}
        title={row.title}
        onOpenNote={onOpenNote}
        className="font-medium"
      />
      {details.length > 0 ? (
        <dl className="mt-1 flex flex-col gap-0.5 text-xs">
          {details.map(({ column, cell }) => (
            <div key={column.id} className="flex min-w-0 gap-1.5">
              <dt className="shrink-0 text-text-muted">{column.label}</dt>
              <dd className="min-w-0 truncate text-text-secondary">
                <CellValue cell={cell} onOpenNote={onOpenNote} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  )
}

interface CellValueProps {
  cell: BaseCell
  onOpenNote: (path: string) => void
}

function CellValue({ cell, onOpenNote }: CellValueProps): ReactNode {
  if (cell.error !== null) {
    return (
      <span title={cell.error} className="text-text-muted">
        —
      </span>
    )
  }
  if (cell.links.length === 0) {
    return <span className="text-text-secondary">{cell.text}</span>
  }
  return (
    <span className="inline-flex min-w-0 flex-wrap gap-x-1.5">
      {cell.links.map((link, index) => (
        <NoteButton
          key={`${link.path}:${index}`}
          path={link.path}
          title={link.title}
          onOpenNote={onOpenNote}
        />
      ))}
    </span>
  )
}

interface NoteButtonProps {
  path: string
  title: string
  onOpenNote: (path: string) => void
  className?: string
}

function NoteButton({ path, title, onOpenNote, className }: NoteButtonProps): ReactElement {
  return (
    <button
      type="button"
      onClick={() => {
        onOpenNote(path)
      }}
      className={cn(
        'min-w-0 truncate text-left text-text underline-offset-2 hover:underline',
        className,
      )}
    >
      {title}
    </button>
  )
}
