import type { ReactElement } from 'react'
import { ArrowRight, Hash } from '@/components/icons'
import { parseNoteIcon, tagDisplayName, type ChatTurn, type NoteToolResult } from '@reflect/core'
import { TagIcon } from '@/components/tags/tag-icon'
import { useApplyTagIcon } from '@/hooks/use-apply-tag-icon'
import { cn } from '@/lib/utils'
import { useRouter } from '@/routing/router'
import { ChatProposalCard } from './chat-proposal-card'

interface ChatTagIconCardProps {
  result: Extract<NoteToolResult, { tool: 'setTagIcon' }>
  /** The owning turn's status — a decision is taken only once it settled. */
  turnStatus: ChatTurn['status']
}

/** How a stored icon reads beside its glyph: the symbol's name, the emoji itself, or "No icon". */
function iconLabel(icon: string | null): string {
  const parsed = icon === null ? null : parseNoteIcon(icon)
  if (parsed?.kind === 'symbol') {
    return parsed.name
  }
  return parsed?.kind === 'emoji' ? parsed.glyph : 'No icon'
}

/** One side of the change: the glyph as the sidebar would draw it, and its name. */
function IconFace({ icon, dimmed }: { icon: string | null; dimmed?: boolean }): ReactElement {
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', dimmed && 'text-text-muted')}>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface">
        <TagIcon icon={icon ?? undefined} className="size-4" emojiClassName="text-base" />
      </span>
      <span className="truncate text-xs">{iconLabel(icon)}</span>
    </span>
  )
}

/**
 * The review card for one proposed tag icon (the `set_tag_icon` tool): the
 * tag's current glyph beside the proposed one, inside the shared
 * {@link ChatProposalCard} shell. Accept writes the icon onto the tag's
 * definition note through the Configure-tag dialog's own writer
 * (`useApplyTagIcon`), re-checked against the definition as it is now.
 */
export function ChatTagIconCard({ result, turnStatus }: ChatTagIconCardProps): ReactElement {
  const applyTagIcon = useApplyTagIcon()
  const { navigate } = useRouter()
  const name = tagDisplayName(result.tag)

  const verb =
    result.decision === 'accepted'
      ? 'Changed the icon of'
      : result.decision === 'rejected'
        ? 'Kept the icon of'
        : 'Proposed an icon for'

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
        applyTagIcon({ tag: result.tag, icon: result.icon, previousIcon: result.previousIcon })
      }
    >
      <div
        className={cn(
          'flex items-center gap-2 rounded-md bg-surface px-2 py-1.5',
          result.decision === 'rejected' && 'opacity-60',
        )}
      >
        <IconFace icon={result.previousIcon} dimmed />
        <ArrowRight aria-hidden className="size-3.5 shrink-0 text-text-muted" />
        <IconFace icon={result.icon} />
      </div>
    </ChatProposalCard>
  )
}
