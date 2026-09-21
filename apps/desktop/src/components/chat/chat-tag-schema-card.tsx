import type { ReactElement } from 'react'
import { Hash } from '@/components/icons'
import { tagDisplayName, type ChatTurn, type NoteToolResult, type TagProperty } from '@reflect/core'
import { useApplyTagSchema } from '@/hooks/use-apply-tag-schema'
import { diffTagSchema, type SchemaDiffRow } from '@/lib/tags/schema-diff'
import { cn } from '@/lib/utils'
import { useRouter } from '@/routing/router'
import { PROPERTY_TYPE_LABELS } from '@/components/tags/tag-config-drafts'
import { ChatProposalCard } from './chat-proposal-card'

interface ChatTagSchemaCardProps {
  result: Extract<NoteToolResult, { tool: 'setTagSchema' }>
  /** The owning turn's status — a decision is taken only once it settled. */
  turnStatus: ChatTurn['status']
}

/** How one property reads on a row: its label, its key, and its type. */
function propertyLabel(property: TagProperty): string {
  return `${property.name} (${property.key}) · ${PROPERTY_TYPE_LABELS[property.type]}`
}

/** The marker and tone each kind of row carries, mirroring the note patch diff. */
const ROW_STYLE: Record<SchemaDiffRow['kind'], { marker: string; className: string }> = {
  added: { marker: '+', className: 'bg-accent/10 text-text' },
  removed: { marker: '−', className: 'bg-destructive/10 text-destructive' },
  changed: { marker: '~', className: 'bg-accent/10 text-text' },
  same: { marker: ' ', className: 'text-text-secondary' },
}

/**
 * The review card for one proposed tag schema (the `set_tag_schema` tool):
 * the resulting property list as a diff against the tag's current one,
 * inside the shared {@link ChatProposalCard} shell. Accept writes the schema
 * onto the tag's definition note through the Configure-tag dialog's own
 * writer and migrates any renamed key's stored values (`useApplyTagSchema`),
 * re-checked against the definition as it is now.
 */
export function ChatTagSchemaCard({ result, turnStatus }: ChatTagSchemaCardProps): ReactElement {
  const applyTagSchema = useApplyTagSchema()
  const { navigate } = useRouter()
  const name = tagDisplayName(result.tag)
  const rows = diffTagSchema(result.previousProperties, result.properties, result.renames)

  const verb =
    result.decision === 'accepted'
      ? 'Changed the properties of'
      : result.decision === 'rejected'
        ? 'Kept the properties of'
        : 'Proposed properties for'

  return (
    <ChatProposalCard
      toolCallId={result.toolCallId}
      decision={result.decision}
      turnStatus={turnStatus}
      label={`${verb} ${name}`}
      header={
        <>
          <Hash aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">
            {verb}{' '}
            <button
              type="button"
              onClick={() =>
                navigate({ kind: 'allNotes', filter: { kind: 'tag', tag: result.tag } })
              }
              className="text-text-secondary underline-offset-2 hover:text-text hover:underline"
            >
              {name}
            </button>
          </span>
        </>
      }
      onAccept={() =>
        applyTagSchema({
          tag: result.tag,
          properties: result.properties,
          previousProperties: result.previousProperties,
          renames: result.renames,
        })
      }
    >
      <div
        className={cn(
          'max-h-64 overflow-auto rounded-md bg-surface text-xs leading-5',
          result.decision === 'rejected' && 'opacity-60',
        )}
      >
        {rows.length === 0 ? (
          <p className="px-2 py-1.5 text-text-secondary">No properties — the schema is cleared.</p>
        ) : (
          rows.map((row) => {
            const style = ROW_STYLE[row.kind]
            const property = row.next ?? row.previous
            return (
              <div
                key={`${row.kind}-${property?.key ?? ''}`}
                className={cn('flex min-w-0 gap-2 px-1', style.className)}
              >
                <span aria-hidden className="w-3 shrink-0 select-none text-center text-text-muted">
                  {style.marker}
                </span>
                <span className="min-w-0 truncate">
                  {property === null ? null : propertyLabel(property)}
                  {row.kind === 'changed' && row.previous !== null && row.next !== null ? (
                    <span className="text-text-muted"> — was {propertyLabel(row.previous)}</span>
                  ) : null}
                </span>
              </div>
            )
          })
        )}
      </div>
      {result.renames.length > 0 ? (
        <p className="px-1 pt-1.5 text-2xs text-text-muted">
          Accepting also moves every note’s stored value to the new{' '}
          {result.renames.length === 1 ? 'key' : 'keys'}:{' '}
          {result.renames.map((rename) => `${rename.from} → ${rename.to}`).join(', ')}.
        </p>
      ) : null}
    </ChatProposalCard>
  )
}
