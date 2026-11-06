import { useState, type ReactElement } from 'react'
import { dailyFormatProblem, type ImportMapping, type ObsidianImportReport } from '@reflect/core'
import { ChevronDown, Refresh } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useObsidianConversion } from '@/hooks/use-obsidian-conversion'
import { useObsidianImportDryRun } from '@/hooks/use-obsidian-import-dry-run'
import { isNativeShell } from '@/lib/platform'
import { isMobileSurface } from '@/lib/platform-surface'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'
import { ObsidianImportMapping } from './obsidian-import-mapping'
import { SettingsSection } from './section'

function count(value: number, one: string, many: string): string {
  return `${value.toLocaleString('en-US')} ${value === 1 ? one : many}`
}

interface PathListProps {
  readonly label: string
  readonly paths: readonly string[]
}

/** A count that expands to the paths behind it. */
function PathList({ label, paths }: PathListProps): ReactElement {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="px-4 py-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="group flex w-full items-center gap-2 text-left text-xs text-text-secondary"
      >
        <span className="min-w-0 flex-1">{label}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 text-text-muted transition-transform duration-150',
            !expanded && '-rotate-90',
          )}
        />
      </button>
      {expanded ? (
        <ul className="mt-1 flex flex-col gap-0.5" aria-label={label}>
          {paths.map((path) => (
            <li key={path} className="truncate text-[11px] text-text-muted">
              {path}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** The plan, one line per effect. */
function ReportLines({ report }: { readonly report: ObsidianImportReport }): ReactElement {
  const { moves, mapping } = report
  const lines: string[] = []
  if (moves.daily > 0 && mapping.daily !== null) {
    lines.push(
      `${count(moves.daily, 'daily note moves', 'daily notes move')} from ${mapping.daily.folder || 'the vault root'}/${mapping.daily.format} to daily/YYYY-MM-DD.`,
    )
  }
  if (moves.attachment > 0) {
    lines.push(
      `${count(moves.attachment, 'attachment moves', 'attachments move')} from ${mapping.attachments ?? ''} to assets/.`,
    )
  }
  if (moves.template > 0) {
    lines.push(
      `${count(moves.template, 'template moves', 'templates move')} from ${mapping.templates ?? ''} to templates/.`,
    )
  }
  if (report.excluded > 0) {
    lines.push(`${count(report.excluded, 'file is', 'files are')} left out of the conversion.`)
  }
  if (report.rewrittenLinks > 0) {
    lines.push(
      `${count(report.rewrittenLinks, 'link is', 'links are')} updated to the new paths, in ${count(report.rewrittenNotes, 'note', 'notes')}.`,
    )
  }
  if (report.normalizing > 0) {
    lines.push(
      `${count(report.normalizing, 'note is', 'notes are')} rewritten in Kore's Markdown (table rules, indentation, spacing), so the first edit afterwards changes only what you type.`,
    )
  }
  if (report.compat.affectedNotes > 0) {
    lines.push(
      `${count(report.compat.affectedNotes, 'note keeps', 'notes keep')} plugin syntax Kore doesn't render, as written (see Obsidian compatibility).`,
    )
  }
  if (lines.length === 0) {
    lines.push('Nothing to convert: this vault already follows Kore’s layout.')
  }
  return (
    <ul className="flex flex-col gap-1 px-4 py-3 text-xs text-text">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

interface ConvertBlockProps {
  /** The mapping as edited now, which the preview may still be catching up with. */
  readonly mapping: ImportMapping
}

/** Converting into a copy: pick an empty folder, then open the copy as a graph. */
function ConvertBlock({ mapping }: ConvertBlockProps): ReactElement {
  const { graph, openRecent } = useGraph()
  const conversion = useObsidianConversion(graph)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const available = isNativeShell() && !isMobileSurface()
  const blocked = mapping.daily !== null && dailyFormatProblem(mapping.daily.format) !== null
  const { progress, result } = conversion

  let status: string
  if (progress !== null) {
    status =
      progress.phase === 'copying'
        ? 'Copying the vault…'
        : `Writing converted notes: ${progress.done.toLocaleString('en-US')} of ${progress.total.toLocaleString('en-US')}…`
  } else if (result !== null) {
    status = `Converted copy written to ${result.destination}: ${count(result.files, 'file', 'files')}, ${count(result.written, 'converted', 'converted')}. This vault is unchanged.`
  } else if (!available) {
    status = 'Converting is available in the Mac app.'
  } else {
    status =
      'Convert into a new, empty folder. This vault is only read; its Git history isn’t copied.'
  }

  const openCopy = (): void => {
    if (result === null) {
      return
    }
    setOpening(true)
    setOpenError(null)
    void openRecent(result.destination)
      .then((opened) => {
        if (!opened) {
          setOpenError(`The copy at ${result.destination} could not be opened.`)
        }
      })
      .finally(() => setOpening(false))
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <p className="min-w-0 text-xs text-text-muted" aria-live="polite">
          {status}
        </p>
        {result === null ? (
          <Button
            type="button"
            size="sm"
            disabled={!available || blocked || conversion.pending}
            onClick={() => conversion.convert(mapping)}
          >
            {conversion.pending ? <Spinner /> : null}
            Convert to a copy…
          </Button>
        ) : (
          <Button type="button" size="sm" disabled={opening} onClick={openCopy}>
            Open the copy
          </Button>
        )}
      </div>
      {result !== null && result.symlinks > 0 ? (
        <p className="text-[11px] text-text-muted">
          {count(result.symlinks, 'symbolic link was', 'symbolic links were')} not copied.
        </p>
      ) : null}
      {(conversion.error ?? openError) === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {conversion.error ?? openError}
        </p>
      )}
    </div>
  )
}

/**
 * Settings → Convert to Kore layout: a dry run of converting an Obsidian
 * vault to Kore's own layout (dailies, attachments, templates, the links that
 * point at them, canonical Markdown). Shown only for vaults with Obsidian
 * settings. It reads every note once, then lets the user correct which folder
 * plays which role and recomputes the report. Converting writes a new copy;
 * the open vault is never written.
 */
export function ObsidianImportSection(): ReactElement {
  const { graph } = useGraph()
  const { source, report, mapping, setMapping, isRunning, error, run } =
    useObsidianImportDryRun(graph)

  let summary: string
  if (error !== null) {
    summary = `The preview failed: ${error.message}`
  } else if (isRunning) {
    summary = 'Reading every note in the vault…'
  } else if (source === undefined) {
    summary =
      'Preview what converting this vault to Kore’s layout would change. The preview reads every note and writes nothing.'
  } else if (source === null) {
    summary = 'This vault has no Obsidian settings, so there is nothing to convert.'
  } else if (report === undefined) {
    summary = 'Working out the conversion…'
  } else {
    summary = `Preview of ${count(report.compat.scanned, 'note', 'notes')}. Check which folder plays which role; the preview follows your changes. Nothing has been written.`
  }

  return (
    <SettingsSection id="obsidian-import">
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <p className="min-w-0 text-xs text-text-muted">{summary}</p>
        <Button type="button" variant="outline" size="sm" disabled={isRunning} onClick={run}>
          {isRunning ? <Spinner /> : <Refresh aria-hidden />}
          {source === undefined ? 'Preview' : 'Read again'}
        </Button>
      </div>
      {source && mapping ? (
        <ObsidianImportMapping mapping={mapping} folders={source.folders} onChange={setMapping} />
      ) : null}
      {report ? (
        <>
          <ReportLines report={report} />
          {report.lossy.length > 0 ? (
            <PathList
              label={`${count(report.lossy.length, 'note is', 'notes are')} copied unchanged: Kore can't save them without losing something.`}
              paths={report.lossy}
            />
          ) : null}
          {report.conflicts.length > 0 ? (
            <PathList
              label={`${count(report.conflicts.length, 'file stays', 'files stay')} in place: the destination is taken.`}
              paths={report.conflicts.map((conflict) => `${conflict.from} → ${conflict.to}`)}
            />
          ) : null}
          {mapping ? <ConvertBlock mapping={mapping} /> : null}
        </>
      ) : null}
    </SettingsSection>
  )
}
