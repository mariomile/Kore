import { useState, type ReactElement } from 'react'
import type { ObsidianImportReport } from '@reflect/core'
import { ChevronDown, Refresh } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useObsidianImportDryRun } from '@/hooks/use-obsidian-import-dry-run'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'
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
  const { moves, layout } = report
  const lines: string[] = []
  if (moves.daily > 0) {
    lines.push(
      `${count(moves.daily, 'daily note moves', 'daily notes move')} from ${layout.dailyFolder || 'the vault root'}/${layout.dailyFormat} to daily/YYYY-MM-DD.`,
    )
  }
  if (moves.attachment > 0) {
    lines.push(
      `${count(moves.attachment, 'attachment moves', 'attachments move')} from ${layout.attachmentFolder ?? ''} to assets/.`,
    )
  }
  if (moves.template > 0) {
    lines.push(
      `${count(moves.template, 'template moves', 'templates move')} from ${layout.templatesFolder} to templates/.`,
    )
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

/**
 * Settings → Convert to Kore layout: a dry run of converting an Obsidian
 * vault to Kore's own layout (dailies, attachments, templates, the links that
 * point at them, canonical Markdown). Shown only for vaults with Obsidian
 * settings. It reads every note and writes nothing.
 */
export function ObsidianImportSection(): ReactElement {
  const { graph } = useGraph()
  const { report, isRunning, error, run } = useObsidianImportDryRun(graph)

  let summary: string
  if (error !== null) {
    summary = `The preview failed: ${error.message}`
  } else if (isRunning) {
    summary = 'Reading every note in the vault…'
  } else if (report === undefined) {
    summary =
      'Preview what converting this vault to Kore’s layout would change. The preview reads every note and writes nothing.'
  } else if (report === null) {
    summary = 'This vault has no Obsidian settings, so there is nothing to convert.'
  } else {
    summary = `Preview of ${count(report.compat.scanned, 'note', 'notes')}. Nothing has been written.`
  }

  return (
    <SettingsSection id="obsidian-import">
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <p className="min-w-0 text-xs text-text-muted">{summary}</p>
        <Button type="button" variant="outline" size="sm" disabled={isRunning} onClick={run}>
          {isRunning ? <Spinner /> : <Refresh aria-hidden />}
          {report === undefined ? 'Preview' : 'Run again'}
        </Button>
      </div>
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
        </>
      ) : null}
    </SettingsSection>
  )
}
