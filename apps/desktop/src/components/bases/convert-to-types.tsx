import { useState, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { baseDisplayName, errorMessage } from '@kore/core'
import { Button } from '@/components/ui/button'
import { convertBasesToTypes, type BasesConversionReport } from '@/lib/bases/convert-bases'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'
import { useRouter } from '@/routing/router'

/**
 * "Convert to type views" (organization point 3): moves what a base shows
 * into the database of the type it lists, so the tag page carries the same
 * tabs. The `.base` files stay untouched; the summary says what moved and,
 * line by line, what a type's views can't hold (formulas above all).
 */
export function ConvertToTypes({
  paths,
  label,
}: {
  /** The bases to convert: one on a base's screen, every base on the index. */
  paths: readonly string[]
  label: string
}): ReactElement {
  const { graph } = useGraph()
  const queryClient = useQueryClient()
  const { navigate } = useRouter()
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<BasesConversionReport | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const run = async (): Promise<void> => {
    if (graph === null || running) {
      return
    }
    setRunning(true)
    setFailure(null)
    try {
      setReport(await convertBasesToTypes(paths, graph.generation))
      await queryClient.invalidateQueries({ queryKey: [INDEX_QUERY_SCOPE, graph.root] })
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setRunning(false)
    }
  }

  const tags = report === null ? [] : [...new Set(report.converted.map((entry) => entry.tag))]

  return (
    <div className="mt-4">
      <Button
        variant="outline"
        size="sm"
        disabled={running || paths.length === 0}
        onClick={() => void run()}
      >
        {running ? 'Converting…' : label}
      </Button>
      {failure === null ? null : (
        <p role="alert" className="mt-2 text-xs text-text-muted">
          Couldn’t convert: {failure}
        </p>
      )}
      {report === null ? null : (
        <section
          aria-label="Conversion summary"
          className="mt-3 rounded-lg border border-border px-3 py-2.5 text-[13px] text-text-secondary"
        >
          <p className="text-text">
            {report.converted.length === 0
              ? 'Nothing to convert: none of these bases lists the notes of a single tag.'
              : `${String(report.converted.length)} ${report.converted.length === 1 ? 'base' : 'bases'} now live as views of ${String(tags.length)} ${tags.length === 1 ? 'type' : 'types'}. The .base files are unchanged.`}
          </p>
          {tags.length === 0 ? null : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <li key={tag}>
                  <button
                    type="button"
                    onClick={() => {
                      navigate({ kind: 'allNotes', filter: { kind: 'tag', tag } })
                    }}
                    className="rounded-md bg-surface-hover px-2 py-0.5 text-xs text-text hover:bg-surface-active"
                  >
                    #{tag}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {report.converted.some((entry) => entry.notes.length > 0) ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-text-muted">
                What didn’t carry over
              </summary>
              <ul className="mt-1.5 flex flex-col gap-1 text-xs">
                {report.converted
                  .filter((entry) => entry.notes.length > 0)
                  .map((entry) => (
                    <li key={entry.path}>
                      <span className="font-medium text-text">{baseDisplayName(entry.path)}</span>
                      <ul className="ml-3 list-disc pl-3">
                        {entry.notes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
          {report.skipped.length === 0 ? null : (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-text-muted">
                {`Left as bases (${String(report.skipped.length)})`}
              </summary>
              <ul className="mt-1.5 flex flex-col gap-1 text-xs">
                {report.skipped.map((entry) => (
                  <li key={entry.path}>
                    <span className="font-medium text-text">{baseDisplayName(entry.path)}</span>:{' '}
                    {entry.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  )
}
