import type { ReactElement } from 'react'
import { normalizeTagInput } from '@kore/core'
import { cn } from '@/lib/utils'
import type { TagRenameForm } from './use-tag-rename-form'

interface TagRenameSummaryProps {
  form: TagRenameForm
  from: string
  /** The phone's sheet reads at body size; the Mac dialog at caption size. */
  size?: 'sm' | 'base'
}

/** Nested tags named in full before the rest collapse into a count. */
const NESTED_SHOWN = 3

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * What a rename is about to do, or what it did, in plain sentences: the
 * notes it changes, a merge, the nested tags that follow, a type's fields
 * that stay put, and the notes it refuses to touch. Nothing is a number
 * without its noun, and nothing the rename skips is left unsaid.
 */
export function TagRenameSummary({
  form,
  from,
  size = 'sm',
}: TagRenameSummaryProps): ReactElement | null {
  const text = size === 'sm' ? 'text-xs' : 'text-sm'
  const fromTag = `#${normalizeTagInput(from)}`
  const { result } = form

  if (result !== null) {
    const { outcome } = result
    return (
      <div className={cn('flex flex-col gap-1.5', text)}>
        <p className="text-text">
          {result.kind === 'renamed'
            ? `${fromTag} is now #${result.to} in ${plural(outcome.changed, 'note', 'notes')}.`
            : `Undone: ${plural(outcome.changed, 'note is', 'notes are')} back on ${fromTag}.`}
        </p>
        {outcome.failures.length > 0 ? (
          <ul className="flex flex-col gap-0.5 text-destructive">
            {outcome.failures.map((failure) => (
              <li key={failure} className="truncate">
                {failure}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    )
  }

  if (form.problem !== null) {
    return <p className={cn(text, 'text-destructive')}>{form.problem}</p>
  }
  const { preview } = form
  if (preview === null) {
    return (
      <p className={cn(text, 'text-text-muted')} aria-live="polite">
        {form.value === from ? 'Type the new name.' : 'Counting notes…'}
      </p>
    )
  }

  const { plan, blocked } = preview
  const to = `#${normalizeTagInput(preview.rename.to)}`
  const changes = plan.writes.length - blocked.length
  const nested = plan.nestedTags
  return (
    <ul className={cn('flex flex-col gap-1.5 text-text-secondary', text)} aria-live="polite">
      <li className="text-text">
        {changes === 0 && plan.moves.length === 0
          ? `No note carries ${fromTag}.`
          : plan.merges
            ? `${to} already exists: ${fromTag} merges into it in ${plural(changes, 'note', 'notes')}.`
            : `Changes ${plural(changes, 'note', 'notes')}.`}
      </li>
      {nested.length > 0 ? (
        <li>
          Nested tags follow:{' '}
          {nested
            .slice(0, NESTED_SHOWN)
            .map((tag) => `#${tag}`)
            .join(', ')}
          {nested.length > NESTED_SHOWN ? ` and ${nested.length - NESTED_SHOWN} more` : ''}.
        </li>
      ) : null}
      {plan.keptDefinitions.map((path) => (
        <li key={path}>
          {to} keeps its own fields. The fields of {fromTag} stay in{' '}
          <code className="font-mono">{path}</code>.
        </li>
      ))}
      {blocked.length > 0 ? (
        <li>
          {plural(blocked.length, 'note has', 'notes have')} unsaved changes and{' '}
          {blocked.length === 1 ? 'stays' : 'stay'} as {blocked.length === 1 ? 'it is' : 'they are'}
          .
        </li>
      ) : null}
    </ul>
  )
}
