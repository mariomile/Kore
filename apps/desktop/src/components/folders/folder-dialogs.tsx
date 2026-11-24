import { useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import {
  collectFolderNotePaths,
  errorMessage,
  findFolder,
  folderDisplayName,
  validateFolderName,
} from '@kore/core'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useFolderTree } from '@/hooks/use-folder-tree'
import { useFolderOperations } from '@/lib/folders/use-folder-operations'
import { isMobileSurface } from '@/lib/platform-surface'

/** Which folder dialog is open, and for which folder (`''` is the vault root). */
export type FolderDialogState =
  | { kind: 'newNote'; folderPath: string }
  | { kind: 'newSubfolder'; folderPath: string }
  | { kind: 'rename'; folderPath: string }
  | { kind: 'trash'; folderPath: string }

interface FolderDialogsProps {
  dialog: FolderDialogState | null
  onClose: () => void
  /** After a note or subfolder is created inside the dialog's folder. */
  onCreatedIn?: (folderPath: string) => void
}

interface FolderTextDialogProps {
  title: string
  description: ReactNode
  inputLabel: string
  placeholder?: string
  initialValue?: string
  submitLabel: string
  busyLabel: string
  validate?: (value: string) => string | null
  onSubmit: (trimmedValue: string) => Promise<void>
  onClose: () => void
}

/** Shared single-input modal backing New note, New subfolder, and Rename folder. */
function FolderTextDialog({
  title,
  description,
  inputLabel,
  placeholder,
  initialValue = '',
  submitLabel,
  busyLabel,
  validate,
  onSubmit,
  onClose,
}: FolderTextDialogProps): ReactElement {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) {
      return
    }
    const problem = validate?.(value) ?? null
    if (problem !== null) {
      setError(problem)
      return
    }
    const trimmed = value.trim()
    if (trimmed === '') {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(trimmed)
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-3">
          <Input
            autoFocus
            aria-label={inputLabel}
            placeholder={placeholder}
            value={value}
            disabled={busy}
            onChange={(event) => {
              setValue(event.target.value)
              setError(null)
            }}
          />
          {error !== null ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" disabled={busy} />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={value.trim() === '' || busy}>
              {busy ? busyLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The folder dialogs the Mac sidebar and the iPhone folder page share: New
 * note, New subfolder, Rename folder, and Move to Trash. Each acts on the
 * real Markdown folder on disk through {@link useFolderOperations}. Moving a
 * folder is the Move to… picker's job, the same one notes use.
 */
export function FolderDialogs({
  dialog,
  onClose,
  onCreatedIn,
}: FolderDialogsProps): ReactElement | null {
  const operations = useFolderOperations()

  if (dialog === null) {
    return null
  }
  const { folderPath } = dialog
  const atRoot = folderPath === ''
  const folderName = atRoot ? 'the vault' : folderDisplayName(folderPath)
  const key = `${dialog.kind}:${folderPath}`

  switch (dialog.kind) {
    case 'newNote':
      return (
        <FolderTextDialog
          key={key}
          title={`New note in ${folderName}`}
          description={
            atRoot ? (
              'Creates a Markdown note at the top of the vault.'
            ) : (
              <>
                Creates a Markdown note directly inside <code>{folderPath}</code>.
              </>
            )
          }
          inputLabel="Note title"
          placeholder="Note title"
          submitLabel="Create"
          busyLabel="Creating…"
          onClose={onClose}
          onSubmit={async (title) => {
            await operations.createNote(folderPath, title)
            onCreatedIn?.(folderPath)
          }}
        />
      )
    case 'newSubfolder':
      return (
        <FolderTextDialog
          key={key}
          title={atRoot ? 'New folder' : `New subfolder in ${folderName}`}
          description={
            atRoot ? (
              'Creates a folder at the top of the vault.'
            ) : (
              <>
                Creates a subfolder inside <code>{folderPath}</code> on disk.
              </>
            )
          }
          inputLabel={atRoot ? 'Folder name' : 'Subfolder name'}
          placeholder="Folder name"
          submitLabel="Create"
          busyLabel="Creating…"
          validate={validateFolderName}
          onClose={onClose}
          onSubmit={async (name) => {
            await operations.createSubfolder(folderPath, name)
            onCreatedIn?.(folderPath)
          }}
        />
      )
    case 'rename':
      return (
        <FolderTextDialog
          key={key}
          title="Rename folder"
          description={
            <>
              Renames <code>{folderPath}</code> on disk and updates open notes and path links.
            </>
          }
          inputLabel="Folder name"
          initialValue={folderName}
          submitLabel="Rename"
          busyLabel="Renaming…"
          validate={validateFolderName}
          onClose={onClose}
          onSubmit={(name) => operations.rename(folderPath, name)}
        />
      )
    case 'trash':
      return (
        <TrashFolderDialog
          key={key}
          folderPath={folderPath}
          onTrash={() => operations.trash(folderPath)}
          onClose={onClose}
        />
      )
  }
}

function TrashFolderDialog({
  folderPath,
  onTrash,
  onClose,
}: {
  folderPath: string
  onTrash: () => Promise<void>
  onClose: () => void
}): ReactElement {
  const tree = useFolderTree()
  const folderNode = tree === null ? null : findFolder(tree, folderPath)
  const count = folderNode === null ? 0 : collectFolderNotePaths(folderNode).length
  // The Mac's system Trash restores; the phone's vault trash has no UI yet.
  const where = isMobileSurface()
    ? 'the vault’s trash. You can recover it on the Mac.'
    : 'the system Trash. You can restore it from there.'
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async (): Promise<void> => {
    if (busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onTrash()
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Move “{folderDisplayName(folderPath)}” to Trash?</DialogTitle>
          <DialogDescription>
            {count === 0
              ? `Moves "${folderPath}" and any files inside it to ${where}`
              : `Moves "${folderPath}" and its ${count} ${count === 1 ? 'note' : 'notes'} (plus any other files inside) to ${where}`}
          </DialogDescription>
        </DialogHeader>
        {error !== null ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" disabled={busy} />}>
            Cancel
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? 'Moving…' : 'Move to Trash'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
