import { useState, type ReactElement } from 'react'
import { isModEvent } from '@meowdown/core'
import type { VaultCompatGroup } from '@reflect/core'
import { CheckCircle, ChevronDown, Refresh } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { useVaultCompatReport } from '@/hooks/use-vault-compat-report'
import { cn } from '@/lib/utils'
import { SettingsSection } from './section'

interface CompatGroupRowProps {
  readonly group: VaultCompatGroup
}

function noteCountLabel(count: number): string {
  return count === 1 ? '1 note' : `${count} notes`
}

/** One unsupported kind: its count and hint, expanding to the notes that carry it. */
function CompatGroupRow({ group }: CompatGroupRowProps): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const navigateNoteLink = useNoteLinkNavigation()

  return (
    <div className="px-4 py-3">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="group flex w-full items-start gap-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-text">{group.label}</span>
          <span className="mt-0.5 block text-xs text-text-muted">{group.hint}</span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-text-secondary">
          {noteCountLabel(group.notes.length)}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            'mt-0.5 size-3.5 shrink-0 text-text-muted transition-transform duration-150 group-hover:text-text-secondary',
            !expanded && '-rotate-90',
          )}
        />
      </button>
      {expanded ? (
        <ul className="mt-2 flex flex-col gap-0.5" aria-label={`Notes with ${group.label}`}>
          {group.notes.map((note) => (
            <li key={note.path}>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto w-full justify-start whitespace-normal px-2 py-1 text-left text-xs"
                onClick={(event) =>
                  navigateNoteLink({
                    target: { kind: 'note', path: note.path },
                    openInSplit: isModEvent(event),
                  })
                }
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-text">
                    {note.title}
                    {note.details.length > 0 ? (
                      <span className="font-normal text-text-muted">
                        {' '}
                        · {note.details.join(', ')}
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-[11px] text-text-muted">{note.path}</span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * Settings → Obsidian compatibility: a read-only report of what this vault
 * holds that Kore doesn't render (plugin code blocks, Templater tags, Mermaid
 * diagram types, canvas and Excalidraw files), with the notes that carry each.
 * Shown only for vaults with Obsidian settings. Nothing here changes a file.
 */
export function VaultCompatSection(): ReactElement {
  const { report, isScanning, error, rescan } = useVaultCompatReport()

  let summary: string
  if (error !== null) {
    summary = `The scan failed: ${error.message}`
  } else if (report === null) {
    summary = 'Reading every note in the vault…'
  } else if (report.groups.length === 0) {
    summary = `Kore renders everything in the ${report.scanned.toLocaleString('en-US')} notes it read.`
  } else {
    summary = `${noteCountLabel(report.affectedNotes)} of ${report.scanned.toLocaleString('en-US')} use something Kore shows differently from Obsidian. Your files are never changed.`
  }
  const skipped =
    report !== null && report.skipped > 0
      ? ` ${noteCountLabel(report.skipped)} not downloaded or unreadable were skipped.`
      : ''

  return (
    <SettingsSection id="vault-compat">
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <p className="flex min-w-0 items-start gap-2 text-xs text-text-muted">
          {report !== null && report.groups.length === 0 ? (
            <CheckCircle aria-hidden className="mt-px size-3.5 shrink-0 text-accent" />
          ) : null}
          <span>
            {summary}
            {skipped}
          </span>
        </p>
        <Button type="button" variant="outline" size="sm" disabled={isScanning} onClick={rescan}>
          {isScanning ? <Spinner /> : <Refresh aria-hidden />}
          Rescan
        </Button>
      </div>
      {report?.groups.map((group) => (
        <CompatGroupRow key={group.kind} group={group} />
      ))}
    </SettingsSection>
  )
}
