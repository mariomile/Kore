import { useDeferredValue, type ReactElement } from 'react'
import { CornerDownRight } from '@/components/icons'
import { parseNoteDirectives, type AssistantPart, type ChatTurn } from '@reflect/core'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Marker, MarkerContent } from '@/components/ui/marker'
import { MarkdownPreview } from '@/editor/markdown-preview'
import { cn } from '@/lib/utils'
import { ChatChangesCard } from './chat-changes-card'
import { ChatContextSources } from './chat-context-sources'
import { ChatNoteCard } from './chat-note-card'
import { ChatToolChip } from './chat-tool-chip'

interface ChatAssistantPartProps {
  part: AssistantPart
  status: ChatTurn['status']
  onWikiLinkClick: (options: { target: string; openInSplit: boolean }) => void
}

/**
 * One assistant transcript part: live markdown, tool
 * activity, or a terminal notice.
 */
export function ChatAssistantPart({
  part,
  status,
  onWikiLinkClick,
}: ChatAssistantPartProps): ReactElement {
  const deferredText = useDeferredValue(part.kind === 'text' ? part.text : '')

  switch (part.kind) {
    case 'text':
      return (
        <Bubble variant="ghost" className="max-w-full">
          <BubbleContent className="flex max-w-full flex-col gap-2 text-text">
            {/* Defer growing markdown behind input; a settled turn flushes
                its final text immediately. The preview reuses unchanged blocks. */}
            {parseNoteDirectives(status === 'streaming' ? deferredText : part.text).map(
              (segment, segmentIndex) =>
                segment.kind === 'note' ? (
                  <ChatNoteCard key={segmentIndex} path={segment.path} />
                ) : (
                  <MarkdownPreview
                    key={segmentIndex}
                    content={segment.text}
                    onWikiLinkClick={onWikiLinkClick}
                    className="reflect-chat-message text-sm"
                  />
                ),
            )}
          </BubbleContent>
        </Bubble>
      )
    case 'tool':
      return <ChatToolChip part={part} turnStatus={status} />
    case 'changes':
      return <ChatChangesCard paths={part.paths} />
    case 'context':
      return <ChatContextSources notes={part.notes} />
    case 'steer':
      // A message the user steered into the live turn — rendered where the
      // reply split around it, styled like a compact user bubble.
      return (
        <div className="flex max-w-[85%] items-start gap-1.5 self-end rounded-lg bg-surface-hover px-3 py-1.5">
          <CornerDownRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-text-muted" />
          <span className="reflect-chat-message text-sm whitespace-pre-wrap text-text">
            {part.text}
          </span>
        </div>
      )
    case 'notice':
      return (
        <Marker
          className={cn(
            'reflect-chat-message text-sm',
            part.tone === 'error' ? 'text-destructive' : 'text-text-muted italic',
          )}
        >
          <MarkerContent>{part.text}</MarkerContent>
        </Marker>
      )
  }
}
