import { useState, type ReactElement } from 'react'
import { useQuery } from '@tanstack/react-query'
import { errorMessage, inferSuggestionFields, type TypeSuggestion } from '@kore/core'
import { ArrowRight, CheckCircle } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'
import { useApplyTypeSuggestion } from './use-apply-type-suggestion'

interface TypeSuggestionsProps {
  suggestions: readonly TypeSuggestion[]
  /** Open the new type's page. */
  onOpenType: (tag: string) => void
  /** Phone rows: larger type and touch-sized buttons. */
  touch?: boolean
}

/**
 * "What Kore sees": groups of notes that are already one kind of thing — a
 * tag many notes share, or a folder of notes that share nothing else — each
 * one tap from becoming a type with a table, a board and fields. Nothing is
 * written until that tap; a folder suggestion, which writes into every
 * note, asks once more and says how many.
 */
export function TypeSuggestions({
  suggestions,
  onOpenType,
  touch = false,
}: TypeSuggestionsProps): ReactElement | null {
  const rows = useStableRows(suggestions)
  if (rows.length === 0) {
    return null
  }
  return (
    <section aria-label="Types Kore found">
      <h2 className="text-2xs font-medium tracking-wide text-text-muted">What Kore sees</h2>
      <p className={cn('mt-2 text-text-secondary text-pretty', touch ? 'text-[15px]' : 'text-sm')}>
        {headline(rows)}
      </p>
      <ul className="mt-2 flex flex-col">
        {rows.map((suggestion) => (
          <TypeSuggestionRow
            key={suggestionKey(suggestion)}
            suggestion={suggestion}
            onOpenType={onOpenType}
            touch={touch}
          />
        ))}
      </ul>
    </section>
  )
}

function suggestionKey(suggestion: TypeSuggestion): string {
  return `${suggestion.source}:${suggestion.tag}`
}

/**
 * The rows as first shown, with later arrivals appended: a suggestion the
 * user just applied drops out of the next read (its tag is a type now), but
 * its row stays put to show it worked and open the new type.
 */
function useStableRows(suggestions: readonly TypeSuggestion[]): readonly TypeSuggestion[] {
  const [shown, setShown] = useState<readonly TypeSuggestion[]>(suggestions)
  const known = new Set(shown.map(suggestionKey))
  const added = suggestions.filter((suggestion) => !known.has(suggestionKey(suggestion)))
  if (added.length === 0) {
    return shown
  }
  // Derived state, adjusted during render (React's documented pattern).
  const next = [...shown, ...added]
  setShown(next)
  return next
}

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six']

/** "Three kinds of things already live in your notes. Make one a type…" */
function headline(suggestions: readonly TypeSuggestion[]): string {
  const count = COUNT_WORDS[suggestions.length] ?? suggestions.length.toLocaleString()
  const kinds =
    suggestions.length === 1 ? 'kind of thing already lives' : 'kinds of things already live'
  return `${count} ${kinds} in your notes. Make one a type and it gets a table, a board and its own fields, without leaving Markdown.`
}

type RowState =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  | { kind: 'working' }
  | { kind: 'done'; tagged: number }
  | { kind: 'failed'; message: string }

function TypeSuggestionRow({
  suggestion,
  onOpenType,
  touch,
}: {
  suggestion: TypeSuggestion
  onOpenType: (tag: string) => void
  touch: boolean
}): ReactElement {
  const { graph } = useGraph()
  const apply = useApplyTypeSuggestion()
  const [state, setState] = useState<RowState>({ kind: 'idle' })
  const { data: fields } = useQuery({
    queryKey: [
      INDEX_QUERY_SCOPE,
      graph?.root,
      'first-look',
      'fields',
      suggestion.source,
      suggestion.tag,
    ],
    queryFn: () => inferSuggestionFields(suggestion),
    enabled: graph !== null,
  })
  const writesNotes = suggestion.source === 'folder'
  const buttonSize = touch ? 'default' : 'sm'

  async function run(): Promise<void> {
    setState({ kind: 'working' })
    try {
      setState({ kind: 'done', tagged: await apply(suggestion) })
    } catch (cause) {
      setState({ kind: 'failed', message: errorMessage(cause) })
    }
  }

  const where =
    suggestion.folder === null || suggestion.folder === ''
      ? `${suggestion.count.toLocaleString()} notes`
      : `${suggestion.count.toLocaleString()} notes in ${suggestion.folder}`

  return (
    <li className={cn('flex flex-col', touch ? 'py-3' : 'py-2.5')}>
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-baseline gap-2">
            <span
              className={cn('truncate font-medium text-text', touch ? 'text-[15px]' : 'text-sm')}
            >
              {suggestion.label}
            </span>
            <span className="shrink-0 text-xs text-text-muted">#{suggestion.tag}</span>
          </p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-xs text-text-secondary tabular-nums">{where}</span>
            {fields?.map((field) => (
              <span
                key={field.name}
                className="rounded-full border border-border px-2 text-2xs leading-5 text-text-secondary"
              >
                {field.name}
              </span>
            ))}
          </div>
        </div>
        {state.kind === 'done' ? (
          <Button
            type="button"
            variant="ghost"
            size={buttonSize}
            className="shrink-0 rounded-full"
            onClick={() => onOpenType(suggestion.tag)}
          >
            <CheckCircle aria-hidden className="text-success" />
            Open type
            <ArrowRight aria-hidden />
          </Button>
        ) : state.kind === 'confirming' ? null : (
          <Button
            type="button"
            variant="outline"
            size={buttonSize}
            className="shrink-0 rounded-full"
            disabled={state.kind === 'working'}
            aria-label={`Make ${suggestion.label} a type`}
            onClick={() => (writesNotes ? setState({ kind: 'confirming' }) : void run())}
          >
            {state.kind === 'working' ? <Spinner /> : null}
            Make it a type
          </Button>
        )}
      </div>
      {state.kind === 'confirming' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-surface-sunken py-2 pr-2 pl-3">
          <p className="min-w-0 flex-1 text-xs text-text-secondary">
            Adds #{suggestion.tag} to the {suggestion.count.toLocaleString()} notes in{' '}
            {suggestion.folder}. Each note keeps everything else it has.
          </p>
          <Button
            type="button"
            variant="ghost"
            size={buttonSize}
            className="rounded-full"
            onClick={() => setState({ kind: 'idle' })}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size={buttonSize}
            className="rounded-full"
            onClick={() => void run()}
          >
            Tag {suggestion.count.toLocaleString()} notes
          </Button>
        </div>
      ) : null}
      {state.kind === 'done' && state.tagged > 0 ? (
        <p className="mt-1.5 text-xs text-text-muted">
          Tagged {state.tagged.toLocaleString()} notes. Nothing else in them changed.
        </p>
      ) : null}
      {state.kind === 'failed' ? (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {state.message}
        </p>
      ) : null}
    </li>
  )
}
