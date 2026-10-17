import { useState, type FormEvent, type ReactElement } from 'react'
import { createNoteInFolder, errorMessage, folderDisplayName } from '@reflect/core'
import { Plus } from '@/components/icons'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useGraph } from '@/providers/graph-provider'
import { useRouter } from '@/routing/router'

interface NewFolderNoteButtonProps {
  /** Graph-relative folder the note is created in. */
  folder: string
}

/**
 * A folder page's "+": a title, Enter, and the note exists in this folder,
 * named by the vault's own rules (Kore's slug or Obsidian's title filename).
 * It asks for the title up front instead of taking ⌘N's lazy untitled route
 * because only the new-note folder renames a file after its first title —
 * a note born here keeps the name it was created with.
 */
export function NewFolderNoteButton({ folder }: NewFolderNoteButtonProps): ReactElement {
  const { graph } = useGraph()
  const { navigate } = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const reset = (): void => {
    setTitle('')
    setError(null)
    setSaving(false)
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (title.trim() === '' || saving || graph === null) {
      return
    }
    setSaving(true)
    try {
      const path = await createNoteInFolder(folder, title, graph.generation)
      setOpen(false)
      reset()
      navigate({ kind: 'note', path })
    } catch (cause) {
      setError(errorMessage(cause))
      setSaving(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          reset()
        }
      }}
    >
      <PopoverTrigger
        aria-label="New note"
        title={`New note in ${folderDisplayName(folder)}`}
        className="app-icon-button text-text-muted hover:text-text"
      >
        <Plus aria-hidden className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-64 p-2">
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-1.5">
          <Input
            autoFocus
            aria-label="Note title"
            placeholder="Note title"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              setError(null)
            }}
            className="h-7 text-sm"
          />
          {error === null ? null : (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between pt-0.5">
            <span className="min-w-0 truncate text-xs text-text-muted">
              In {folderDisplayName(folder)}
            </span>
            <button
              type="submit"
              disabled={title.trim() === '' || saving}
              className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-soft-text transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
