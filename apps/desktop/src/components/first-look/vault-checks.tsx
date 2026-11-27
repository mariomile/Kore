import { useId, useState, type ReactElement } from 'react'
import { displayNoteTitle, type FirstLookNote, type VaultFirstLook } from '@kore/core'
import { CheckCircle, ChevronRight } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Rows a check shows before "Show more": a glance, not a dump. */
const FIRST_ROWS = 8

interface VaultChecksProps {
  look: VaultFirstLook
  onOpenNote: (path: string) => void
  /** Phone rows: larger type and 44pt rows. */
  touch?: boolean
}

type CheckId = 'orphans' | 'broken' | 'duplicates'

interface CheckRow {
  readonly key: string
  readonly primary: string
  readonly secondary: string
  /** The note the row opens. */
  readonly path: string
}

interface Check {
  readonly id: CheckId
  readonly count: number
  readonly label: string
  /** What the count counts, read after it: "428 unlinked notes". */
  readonly unit: string
  readonly detail: string
  /** The line shown when the check finds nothing. */
  readonly clean: string
  readonly rows: readonly CheckRow[]
}

function folderLabel(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? 'Vault root' : path.slice(0, slash)
}

function noteRow(note: FirstLookNote): CheckRow {
  return {
    key: note.path,
    primary: displayNoteTitle(note.title),
    secondary: folderLabel(note.path),
    path: note.path,
  }
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`
}

function checksOf(look: VaultFirstLook): Check[] {
  return [
    {
      id: 'orphans',
      count: look.orphans.count,
      label: 'Unlinked notes',
      unit: look.orphans.count === 1 ? 'unlinked note' : 'unlinked notes',
      clean: 'Every note links or is linked.',
      detail: 'Nothing links to them and they link nowhere.',
      rows: look.orphans.sample.map(noteRow),
    },
    {
      id: 'broken',
      count: look.brokenLinks.targets,
      label: 'Missing notes',
      unit: look.brokenLinks.targets === 1 ? 'missing note' : 'missing notes',
      clean: 'Every link lands on a note.',
      detail: `${plural(look.brokenLinks.links, 'link points', 'links point')} at notes that don’t exist yet.`,
      rows: look.brokenLinks.sample.flatMap((target) => {
        const first = target.sources[0]
        return first === undefined
          ? []
          : [
              {
                key: target.target,
                primary: `[[${target.target}]]`,
                secondary:
                  target.sources.length === 1
                    ? `in ${displayNoteTitle(first.title)}`
                    : `in ${displayNoteTitle(first.title)} and ${plural(target.sources.length - 1, 'other', 'others')}`,
                path: first.path,
              },
            ]
      }),
    },
    {
      id: 'duplicates',
      count: look.duplicates.count,
      label: 'Same title twice',
      unit: look.duplicates.count === 1 ? 'title used twice' : 'titles used twice',
      clean: 'No two notes share a title.',
      detail: 'A [[link]] to one of them can land on the other.',
      rows: look.duplicates.sample.flatMap((group) =>
        group.notes.map((note) => ({ ...noteRow(note), key: `${group.title}:${note.path}` })),
      ),
    },
  ]
}

/**
 * Three things worth a look, found without AI: notes nothing links, links
 * to notes that don't exist, and titles used more than once. Read as a short
 * report, one line per check: a line with findings opens its notes beneath
 * it, a clean line says so and stays still. A row opens the note to fix it
 * there. Nothing here changes a file.
 */
export function VaultChecks({ look, onOpenNote, touch = false }: VaultChecksProps): ReactElement {
  const [open, setOpen] = useState<CheckId | null>(null)
  const checks = checksOf(look)

  return (
    <section aria-label="Worth a look">
      <h2 className="text-2xs font-medium tracking-wide text-text-muted">Worth a look</h2>
      <ul className="-mx-2.5 mt-2 flex flex-col">
        {checks.map((check) => (
          <li key={check.id}>
            {check.count === 0 ? (
              <div
                className={cn('flex items-center gap-3 px-2.5', touch ? 'min-h-11 py-2' : 'py-2')}
              >
                <CheckCircle aria-hidden className="size-4 shrink-0 text-success" />
                <span className={cn('text-text-secondary', touch ? 'text-[15px]' : 'text-sm')}>
                  {check.clean}
                </span>
              </div>
            ) : (
              <CheckDisclosure
                check={check}
                expanded={open === check.id}
                onToggle={() => setOpen((current) => (current === check.id ? null : check.id))}
                onOpenNote={onOpenNote}
                touch={touch}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function CheckDisclosure({
  check,
  expanded,
  onToggle,
  onOpenNote,
  touch,
}: {
  check: Check
  expanded: boolean
  onToggle: () => void
  onOpenNote: (path: string) => void
  touch: boolean
}): ReactElement {
  const listId = useId()
  const [showAll, setShowAll] = useState(false)
  const rows = showAll ? check.rows : check.rows.slice(0, FIRST_ROWS)
  const hiddenRows = check.rows.length - rows.length
  return (
    <>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={onToggle}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-2.5 text-left transition-colors duration-100 hover:bg-surface-hover active:bg-surface-active',
          touch ? 'min-h-11 py-2.5' : 'py-2',
        )}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-text-muted transition-transform duration-150 ease-swift',
            expanded && 'rotate-90',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className={cn('block text-text', touch ? 'text-[15px]' : 'text-sm')}>
            <span className="font-semibold tabular-nums">{check.count.toLocaleString()}</span>{' '}
            {check.unit}
          </span>
          <span className="block text-xs text-text-muted">{check.detail}</span>
        </span>
      </button>
      {expanded ? (
        <ul id={listId} aria-label={check.label} className="mt-1 mb-2 flex flex-col pl-7">
          {rows.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                onClick={() => onOpenNote(row.path)}
                className={cn(
                  'flex w-full items-baseline gap-3 rounded-md px-2.5 text-left transition-colors duration-100 hover:bg-surface-hover active:bg-surface-active',
                  touch ? 'min-h-11 py-2.5' : 'py-1.5',
                )}
              >
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-text',
                    touch ? 'text-[15px]' : 'text-sm',
                  )}
                >
                  {row.primary}
                </span>
                <span className="max-w-[45%] shrink-0 truncate text-xs text-text-muted">
                  {row.secondary}
                </span>
              </button>
            </li>
          ))}
          {hiddenRows > 0 ? (
            <li>
              <Button
                type="button"
                variant="ghost"
                size={touch ? 'default' : 'sm'}
                className="mt-1 rounded-full text-text-secondary"
                onClick={() => setShowAll(true)}
              >
                Show {hiddenRows.toLocaleString()} more
              </Button>
            </li>
          ) : check.count > check.rows.length && check.id !== 'duplicates' ? (
            <li className="px-2.5 pt-1 text-xs text-text-muted">
              and {(check.count - check.rows.length).toLocaleString()} more
            </li>
          ) : null}
        </ul>
      ) : null}
    </>
  )
}
