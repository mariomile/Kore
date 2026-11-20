import { useMemo, useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import {
  collectFolderNotePaths,
  createFolder,
  createNoteWithSource,
  errorMessage,
  findFolder,
  folderDisplayName,
  newNoteSource,
  validateFolderName,
  type FolderTreeFolder,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  deleteFolderCarryingIndex,
  moveFolderCarryingSessions,
  retargetFolderRoute,
  routeIsInsideFolder,
} from '@/lib/folders/folder-actions'
import { startOperation } from '@/lib/operations'
import { invalidateIndexQueries } from '@/lib/query-client'
import { useGraph } from '@/providers/graph-provider'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'

export type FolderDialogState =
  | { kind: 'newNote'; folderPath: string }
  | { kind: 'newSubfolder'; folderPath: string }
  | { kind: 'rename'; folderPath: string }
  | { kind: 'move'; folderPath: string }
  | { kind: 'trash'; folderPath: string }

interface SidebarFolderDialogsProps {
  dialog: FolderDialogState | null
  tree: FolderTreeFolder
  onClose: () => void
  onEnsureExpanded: (folderPath: string) => void
}

const VAULT_ROOT_VALUE = '__root__'

function parentOf(folderPath: string): string {
  const slash = folderPath.lastIndexOf('/')
  return slash === -1 ? '' : folderPath.slice(0, slash)
}

/** Collect every folder path in `tree` except `excludePath` and its descendants. */
function availableMoveTargets(tree: FolderTreeFolder, excludePath: string): string[] {
  const prefix = `${excludePath}/`
  const out: string[] = []
  const walk = (node: FolderTreeFolder): void => {
    for (const child of node.folders) {
      if (child.path === excludePath || child.path.startsWith(prefix)) {
        continue
      }
      out.push(child.path)
      walk(child)
    }
  }
  walk(tree)
  return out
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
 * Dialogs backing the Folders sidebar context menu: New note, New subfolder,
 * Rename folder, Move folder, and Move to Trash. Each operates on the real
 * Markdown folder on disk and keeps open editors, index rows, links, and
 * routes synchronized.
 */
export function SidebarFolderDialogs({
  dialog,
  tree,
  onClose,
  onEnsureExpanded,
}: SidebarFolderDialogsProps): ReactElement | null {
  const { graph, indexGeneration } = useGraph()
  const { route, navigate } = useRouter()

  if (dialog === null) {
    return null
  }
  const { folderPath } = dialog
  const folderName = folderDisplayName(folderPath)
  const key = `${dialog.kind}:${folderPath}`

  switch (dialog.kind) {
    case 'newNote':
      return (
        <FolderTextDialog
          key={key}
          title={`New note in ${folderName}`}
          description={
            <>
              Creates a Markdown note directly inside <code>{folderPath}</code>.
            </>
          }
          inputLabel="Note title"
          placeholder="Note title"
          submitLabel="Create"
          busyLabel="Creating…"
          onClose={onClose}
          onSubmit={async (title) => {
            if (graph === null) {
              return
            }
            const path = await createNoteWithSource(
              title,
              newNoteSource(title),
              graph.generation,
              folderPath,
            )
            onEnsureExpanded(folderPath)
            invalidateIndexQueries()
            navigate(routeForPath(path))
          }}
        />
      )
    case 'newSubfolder':
      return (
        <FolderTextDialog
          key={key}
          title={`New subfolder in ${folderName}`}
          description={
            <>
              Creates a subfolder inside <code>{folderPath}</code> on disk.
            </>
          }
          inputLabel="Subfolder name"
          placeholder="Folder name"
          submitLabel="Create"
          busyLabel="Creating…"
          validate={validateFolderName}
          onClose={onClose}
          onSubmit={async (name) => {
            if (graph === null) {
              return
            }
            const nextPath = `${folderPath}/${name}`
            await createFolder(nextPath, graph.generation)
            onEnsureExpanded(folderPath)
            invalidateIndexQueries()
            startOperation(`Created ${folderDisplayName(nextPath)}`).done()
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
          onSubmit={async (nextName) => {
            if (graph === null || nextName === folderName) {
              return
            }
            const parent = parentOf(folderPath)
            const nextPath = parent === '' ? nextName : `${parent}/${nextName}`
            const folderNode = findFolder(tree, folderPath)
            const notePaths = folderNode === null ? [] : collectFolderNotePaths(folderNode)
            await moveFolderCarryingSessions({
              from: folderPath,
              to: nextPath,
              notePaths,
              generation: graph.generation,
              indexGeneration,
            })
            const nextRoute = retargetFolderRoute(route, folderPath, nextPath)
            if (nextRoute !== null) {
              navigate(nextRoute)
            }
            startOperation(`Renamed folder to ${nextName}`).done()
          }}
        />
      )
    case 'move':
      return <MoveFolderDialog key={key} folderPath={folderPath} tree={tree} onClose={onClose} />
    case 'trash':
      return <TrashFolderDialog key={key} folderPath={folderPath} tree={tree} onClose={onClose} />
  }
}

function MoveFolderDialog({
  folderPath,
  tree,
  onClose,
}: {
  folderPath: string
  tree: FolderTreeFolder
  onClose: () => void
}): ReactElement {
  const { graph, indexGeneration } = useGraph()
  const { route, navigate } = useRouter()
  const currentParent = parentOf(folderPath)
  const folderName = folderDisplayName(folderPath)
  const targets = useMemo(() => availableMoveTargets(tree, folderPath), [tree, folderPath])
  const [destination, setDestination] = useState<string>(
    currentParent === '' ? VAULT_ROOT_VALUE : currentParent,
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const targetParent = destination === VAULT_ROOT_VALUE ? '' : destination
  const nextPath = targetParent === '' ? folderName : `${targetParent}/${folderName}`
  const unchanged = nextPath === folderPath

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy || graph === null) {
      return
    }
    if (unchanged) {
      onClose()
      return
    }
    const folderNode = findFolder(tree, folderPath)
    const notePaths = folderNode === null ? [] : collectFolderNotePaths(folderNode)
    setBusy(true)
    setError(null)
    try {
      await moveFolderCarryingSessions({
        from: folderPath,
        to: nextPath,
        notePaths,
        generation: graph.generation,
        indexGeneration,
      })
      const nextRoute = retargetFolderRoute(route, folderPath, nextPath)
      if (nextRoute !== null) {
        navigate(nextRoute)
      }
      startOperation(`Moved ${folderName}`).done()
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
          <DialogTitle>Move “{folderName}”</DialogTitle>
          <DialogDescription>
            Choose a destination folder. Moves the Markdown directory on disk and updates links.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
          <Select
            value={destination}
            items={{
              [VAULT_ROOT_VALUE]: 'Vault root (/)',
              ...Object.fromEntries(targets.map((target) => [target, target])),
            }}
            onValueChange={(value) => {
              if (typeof value === 'string') {
                setDestination(value)
                setError(null)
              }
            }}
          >
            <SelectTrigger aria-label="Destination folder">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={VAULT_ROOT_VALUE}>Vault root (/)</SelectItem>
              {targets.map((target) => (
                <SelectItem key={target} value={target}>
                  {target}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error !== null ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" disabled={busy} />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={unchanged || busy}>
              {busy ? 'Moving…' : 'Move'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TrashFolderDialog({
  folderPath,
  tree,
  onClose,
}: {
  folderPath: string
  tree: FolderTreeFolder
  onClose: () => void
}): ReactElement {
  const { graph, indexGeneration } = useGraph()
  const { route, navigate } = useRouter()
  const folderNode = findFolder(tree, folderPath)
  const notePaths = folderNode === null ? [] : collectFolderNotePaths(folderNode)
  const count = notePaths.length
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async (): Promise<void> => {
    if (busy || graph === null) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await deleteFolderCarryingIndex({
        path: folderPath,
        notePaths,
        generation: graph.generation,
        indexGeneration,
      })
      if (routeIsInsideFolder(route, folderPath)) {
        navigate({ kind: 'allNotes', filter: { kind: 'all' } })
      }
      startOperation(`Moved ${folderDisplayName(folderPath)} to Trash`).done()
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
              ? `Moves "${folderPath}" and any files inside it to the system Trash. You can restore it from there.`
              : `Moves "${folderPath}" and its ${count} ${count === 1 ? 'note' : 'notes'} (plus any other files inside) to the system Trash. You can restore it from there.`}
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
