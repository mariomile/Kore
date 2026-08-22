import { useState, type ReactElement } from 'react'
import { FileText, History } from 'lucide-react'
import { displayNoteTitle, noteFileStem } from '@reflect/core'
import { NoteHistoryDialog } from '@/components/note-history-dialog'
import { Button } from '@/components/ui/button'
import { useNoteRow } from '@/hooks/use-note-row'
import { useRouter } from '@/routing/router'

interface ChatChangesCardProps {
  /** Graph-relative paths the agent run touched. */
  paths: string[]
}

/**
 * The agent run's activity ledger, rendered at the end of an edit-mode turn:
 * every note the run touched (diffed against the pre-run snapshot), each row
 * opening the note, with its version history — diff and one-click restore —
 * a click away. This is what makes agent autonomy reviewable: nothing an
 * agent does to the vault is ever silent or unrecoverable.
 */
export function ChatChangesCard({ paths }: ChatChangesCardProps): ReactElement {
  return (
    <div className="mt-1 rounded-lg border border-border bg-surface-sunken p-2">
      <p
        className="px-1 pb-1 text-xs font-medium text-text-secondary"
        title="Everything that changed in the vault during this run — edits you made yourself in that window included."
      >
        {paths.length === 1 ? 'Edited 1 note' : `Edited ${paths.length} notes`}
      </p>
      <ul className="space-y-0.5">
        {paths.map((path) => (
          <ChangedNoteRow key={path} path={path} />
        ))}
      </ul>
    </div>
  )
}

function ChangedNoteRow({ path }: { path: string }): ReactElement {
  const { navigate } = useRouter()
  const row = useNoteRow(path)
  const [historyOpen, setHistoryOpen] = useState(false)
  const title = displayNoteTitle(row?.title ?? noteFileStem(path))

  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          navigate({ kind: 'note', path })
        }}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors duration-100 hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
      >
        <FileText aria-hidden className="size-3.5 shrink-0 text-text-muted" />
        <span className="truncate text-sm text-text">{title}</span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`History of ${title}`}
        title="History — review the change, restore any version"
        onClick={() => setHistoryOpen(true)}
      >
        <History aria-hidden className="size-3.5" />
      </Button>
      <NoteHistoryDialog path={path} open={historyOpen} onOpenChange={setHistoryOpen} />
    </li>
  )
}
