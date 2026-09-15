import { useMemo, useState, type FormEvent, type ReactElement } from 'react'
import { errorMessage, isPropertyKey, type NoteListEntry } from '@reflect/core'
import { Plus } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from '@/components/ui/toast'
import { useCommitNoteProperties } from '@/lib/tags/use-commit-note-property'

export interface ReusableCollectionActionsProps {
  notes: readonly NoteListEntry[]
  memberPaths: ReadonlySet<string>
  selectedPaths: readonly string[]
  onAdd: (path: string) => Promise<void>
  onRemove: (paths: readonly string[]) => Promise<void>
  onDone: () => void
}

/** Membership and loose-property actions for a reusable collection table. */
export function ReusableCollectionActions({
  notes,
  memberPaths,
  selectedPaths,
  onAdd,
  onRemove,
  onDone,
}: ReusableCollectionActionsProps): ReactElement {
  const [removing, setRemoving] = useState(false)
  const commitProperties = useCommitNoteProperties()

  const remove = async (): Promise<void> => {
    if (selectedPaths.length === 0 || removing) return
    setRemoving(true)
    try {
      await onRemove(selectedPaths)
      onDone()
    } catch (cause) {
      toast.add({
        type: 'error',
        title: "Couldn't remove the notes",
        description: errorMessage(cause),
      })
      setRemoving(false)
    }
  }

  return (
    <div className="flex min-h-9 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
      {selectedPaths.length === 0 ? (
        <span className="text-xs text-text-muted">Select rows to edit note properties.</span>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-secondary">
            {selectedPaths.length} selected
          </span>
          <SetPropertyPopover
            onSet={(key, value) => {
              for (const path of selectedPaths) commitProperties(path, { [key]: value })
              onDone()
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={removing}
            onClick={() => void remove()}
          >
            Remove from collection
          </Button>
        </div>
      )}
      <AddNotePopover notes={notes} memberPaths={memberPaths} onAdd={onAdd} />
    </div>
  )
}

function SetPropertyPopover({
  onSet,
}: {
  onSet: (key: string, value: string) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const valid = isPropertyKey(key.trim())
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!valid) return
    onSet(key.trim(), value)
    setOpen(false)
    setKey('')
    setValue('')
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="ghost" size="sm" />}>
        Set property…
      </PopoverTrigger>
      <PopoverContent align="start">
        <form className="space-y-2" onSubmit={submit}>
          <p className="text-xs text-text-muted">
            Writes a note-owned property to the selected original notes.
          </p>
          <Input
            aria-label="Property key"
            placeholder="status"
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
          <Input
            aria-label="Property value"
            placeholder="Next"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          {key !== '' && !valid ? (
            <p role="alert" className="text-xs text-destructive">
              Use a non-reserved property key.
            </p>
          ) : null}
          <Button type="submit" size="sm" disabled={!valid}>
            Set
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function AddNotePopover({
  notes,
  memberPaths,
  onAdd,
}: {
  notes: readonly NoteListEntry[]
  memberPaths: ReadonlySet<string>
  onAdd: (path: string) => Promise<void>
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  const available = useMemo(() => {
    const folded = query.trim().toLocaleLowerCase()
    return notes
      .filter(
        (note) =>
          !memberPaths.has(note.path) &&
          (folded === '' || note.title.toLocaleLowerCase().includes(folded)),
      )
      .slice(0, 50)
  }, [memberPaths, notes, query])
  const add = async (path: string): Promise<void> => {
    setAdding(path)
    try {
      await onAdd(path)
      setOpen(false)
      setQuery('')
    } catch (cause) {
      toast.add({ type: 'error', title: "Couldn't add the note", description: errorMessage(cause) })
    } finally {
      setAdding(null)
    }
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="ghost" size="sm" />}>
        <Plus className="size-3.5" />
        Add notes
      </PopoverTrigger>
      <PopoverContent align="end">
        <Input
          autoFocus
          aria-label="Search notes to add"
          placeholder="Search notes…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="max-h-56 overflow-y-auto">
          {available.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-text-muted">No notes to add.</p>
          ) : (
            available.map((note) => (
              <button
                key={note.path}
                type="button"
                disabled={adding !== null}
                onClick={() => void add(note.path)}
                className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-hover disabled:opacity-50"
              >
                {note.title}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
