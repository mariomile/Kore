import type { ReactElement, ReactNode } from 'react'
import type { BaseCell, BaseColumn, BaseResultRow, BaseViewResult } from '@reflect/core'
import { cn } from '@/lib/utils'

interface BaseViewContentProps {
  result: BaseViewResult
  onOpenNote: (path: string) => void
  /** Embedded in a note: tighter padding, no stand-in notice. */
  compact?: boolean
}

/**
 * One base view, read-only: a table, cards, a list or a board (a grouped
 * plugin `kanban`), with `groupBy` shown as sections. Every note title and
 * linked value opens its note.
 */
export function BaseViewContent({
  result,
  onOpenNote,
  compact = false,
}: BaseViewContentProps): ReactElement {
  const gutter = compact ? 'px-0' : 'px-12'
  if (result.rows.length === 0) {
    return <p className={cn('py-6 text-sm text-text-muted', gutter)}>No notes match this view.</p>
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
        <div className={cn('flex items-start gap-3 overflow-x-auto pb-4', gutter)}>
          {result.groups.map((group) => (
            <section
              key={group.key}
              aria-label={group.key === '' ? 'None' : group.key}
              className="flex w-64 flex-none flex-col rounded-xl bg-surface-sunken p-2"
            >
              <header className="flex items-center gap-1.5 px-1.5 pb-2">
                <h3 className="min-w-0 flex-1 truncate text-xs font-medium text-text-secondary">
                  {group.key === '' ? 'None' : group.key}
                </h3>
                <span className="text-xs tabular-nums text-text-muted">{group.rows.length}</span>
              </header>
              <div className="flex flex-col gap-1.5">
                {group.rows.map((row) => (
                  <BaseCard
                    key={row.path}
                    row={row}
                    columns={result.columns}
                    onOpenNote={onOpenNote}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    )
  }

  const sections =
    result.groups === null
      ? [{ key: null, rows: result.rows }]
      : result.groups.map((group) => ({ key: group.key, rows: group.rows }))
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
            />
          </div>
        </section>
      ))}
      {more}
    </div>
  )
}

interface BaseRowsProps {
  layout: BaseViewResult['layout']
  rows: readonly BaseResultRow[]
  columns: readonly BaseColumn[]
  onOpenNote: (path: string) => void
}

function BaseRows({ layout, rows, columns, onOpenNote }: BaseRowsProps): ReactElement {
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
              {row.cells.map((cell, index) => (
                <td
                  key={columns[index]?.id ?? index}
                  className="max-w-80 truncate py-1.5 pr-4 align-top"
                >
                  <CellValue cell={cell} onOpenNote={onOpenNote} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function isTitleColumn(column: BaseColumn | undefined): boolean {
  return column?.id === 'file.name' || column?.id === 'file.basename'
}

interface BaseCardProps {
  row: BaseResultRow
  columns: readonly BaseColumn[]
  onOpenNote: (path: string) => void
}

function BaseCard({ row, columns, onOpenNote }: BaseCardProps): ReactElement {
  const details = row.cells.flatMap((cell, index) => {
    const column = columns[index]
    return column === undefined ||
      isTitleColumn(column) ||
      (cell.text === '' && cell.error === null)
      ? []
      : [{ column, cell }]
  })
  return (
    <article className="rounded-lg border border-border bg-surface px-3 py-2">
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
