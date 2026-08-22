import type { ReactElement } from 'react'
import { CornerDownRight } from '@/components/icons'
import { parseNoteDirectives, type AssistantPart, type ChatTurn } from '@reflect/core'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Marker, MarkerContent } from '@/components/ui/marker'
import { MarkdownPreview } from '@/editor/markdown-preview'
import { cn } from '@/lib/utils'
import { ChatChangesCard } from './chat-changes-card'
import { ChatNoteCard } from './chat-note-card'
import { ChatToolChip } from './chat-tool-chip'

interface ChatAssistantPartProps {
  index: number
  lastIndex: number
  part: AssistantPart
  status: ChatTurn['status']
  onWikiLinkClick: (options: { target: string; openInNewWindow: boolean }) => void
}

/**
 * One assistant transcript part: streaming text, settled markdown, tool
 * activity, or a terminal notice.
 */
export function ChatAssistantPart({
  index,
  lastIndex,
  part,
  status,
  onWikiLinkClick,
}: ChatAssistantPartProps): ReactElement {
  switch (part.kind) {
    case 'text':
      return status === 'streaming' && index === lastIndex ? (
        <Bubble variant="ghost" className="max-w-full">
          <BubbleContent className="reflect-chat-message max-w-full text-text">
            <div className="whitespace-pre-wrap">{part.text}</div>
          </BubbleContent>
        </Bubble>
      ) : (
        <Bubble variant="ghost" className="max-w-full">
          <BubbleContent className="flex max-w-full flex-col gap-2 text-text">
            {/* Settled text may carry ::note{…} directives — each becomes a
                card that opens the note; the surrounding markdown renders
                as before. Unsafe paths never leave the markdown. */}
            {parseNoteDirectives(part.text).map((segment, segmentIndex) =>
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
      return <ChatToolChip part={part} />
    case 'changes':
      return <ChatChangesCard paths={part.paths} />
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
