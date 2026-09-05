import type { ReactElement } from 'react'
import type { AssistantPart } from '@reflect/core'
import { ChatNoteCard } from './chat-note-card'

interface ChatContextSourcesProps {
  notes: Extract<AssistantPart, { kind: 'context' }>['notes']
}

/** Inspect the note excerpts included with a request, including after restart. */
export function ChatContextSources({ notes }: ChatContextSourcesProps): ReactElement {
  return (
    <details className="w-full min-w-0 text-sm text-text-secondary">
      <summary className="cursor-pointer rounded-sm text-xs focus-visible:outline-2 focus-visible:outline-focus-ring">
        Context used · {notes.length} {notes.length === 1 ? 'note' : 'notes'}
      </summary>
      <div className="mt-2 flex flex-col gap-3">
        <p className="text-xs text-text-muted">Excerpts captured when you sent this message.</p>
        {notes.map((note) => (
          <div key={`${note.source}:${note.path}`} className="min-w-0 space-y-1">
            <span className="text-xs text-text-muted">
              {note.source === 'recall' ? 'Found automatically' : 'Mentioned by you'}
            </span>
            <ChatNoteCard path={note.path} />
            <p className="whitespace-pre-wrap wrap-anywhere">{note.excerpt}</p>
          </div>
        ))}
      </div>
    </details>
  )
}
