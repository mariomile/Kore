import { useMemo, useState, type FormEvent, type ReactElement } from 'react'
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
  if (dialog === null) {
    return null
  }
  // Keyed on `(kind, folderPath)` so each open starts from a fresh draft.
  const key = `${dialog.kind}:${dialog.folderPath}`
  switch (dialog.kind) {
    case 'newNote':
      return (
        <NewNoteInFolderDialog
          key={key}
          folderPath={dialog.folderPath}
          onClose={onClose}
          onEnsureExpanded={onEnsureExpanded}
        />
      )
    case 'newSubfolder':
      return (
        <NewSubfolderDialog
          key={key}
          folderPath={dialog.folderPath}
          onClose={onClose}
          onEnsureExpanded={onEnsureExpanded}
        />
      )
    case 'rename':
      return (
        <RenameFolderDialog
          key={key}
          folderPath={dialog.folderPath}
          tree={tree}
          onClose={onClose}
        />
      )
    case 'move':
      return (
        <MoveFolderDialog key={key} folderPath={dialog.folderPath} tree={tree} onClose={onClose} />
      )
    case 'trash':
      return (
        <TrashFolderDialog key={key} folderPath={dialog.folderPath} tree={tree} onClose={onClose} />
      )
  }
}

function NewNoteInFolderDialog({
  folderPath,
  onClose,
  onEnsureExpanded,
}: {
  folderPath: string
  onClose: () => void
  onEnsureExpanded: (path: string) => void
}): ReactElement {
  const { graph } = useGraph()
  const { navigate } = useRouter()
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const trimmed = title.trim()
    if (trimmed === '' || busy || graph === null) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const path = await createNoteWithSource(
        trimmed,
        newNoteSource(trimmed),
        graph.generation,
        folderPath,
      )
      onEnsureExpanded(folderPath)
      invalidateIndexQueries()
      onClose()
      navigate(routeForPath(path))
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New note in {folderDisplayName(folderPath)}</DialogTitle>
          <DialogDescription>
            Creates a Markdown note directly inside <code>{folderPath}</code>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
          <Input
            autoFocus
            aria-label="Note title"
            placeholder="Note title"
            value={title}
            disabled={busy}
            onChange={(event) => {
              setTitle(event.target.value)
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
            <Button type="submit" disabled={title.trim() === '' || busy}>
              {busy ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function NewSubfolderDialog({
  folderPath,
  onClose,
  onEnsureExpanded,
}: {
  folderPath: string
  onClose: () => void
  onEnsureExpanded: (path: string) => void
}): ReactElement {
  const { graph } = useGraph()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy || graph === null) {
      return
    }
    const problem = validateFolderName(name)
    if (problem !== null) {
      setError(problem)
      return
    }
    const nextPath = `${folderPath}/${name.trim()}`
    setBusy(true)
    setError(null)
    try {
      await createFolder(nextPath, graph.generation)
      onEnsureExpanded(folderPath)
      invalidateIndexQueries()
      startOperation(`Created ${folderDisplayName(nextPath)}`).done()
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
          <DialogTitle>New subfolder in {folderDisplayName(folderPath)}</DialogTitle>
          <DialogDescription>
            Creates a subfolder inside <code>{folderPath}</code> on disk.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
          <Input
            autoFocus
            aria-label="Subfolder name"
            placeholder="Folder name"
            value={name}
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value)
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
            <Button type="submit" disabled={name.trim() === '' || busy}>
              {busy ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RenameFolderDialog({
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
  const currentName = folderDisplayName(folderPath)
  const [name, setName] = useState(currentName)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy || graph === null) {
      return
    }
    const problem = validateFolderName(name)
    if (problem !== null) {
      setError(problem)
      return
    }
    const trimmed = name.trim()
    if (trimmed === currentName) {
      onClose()
      return
    }
    const parent = parentOf(folderPath)
    const nextPath = parent === '' ? trimmed : `${parent}/${trimmed}`
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
      startOperation(`Renamed folder to ${trimmed}`).done()
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
          <DialogTitle>Rename folder</DialogTitle>
          <DialogDescription>
            Renames <code>{folderPath}</code> on disk and updates open notes and path links.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
          <Input
            autoFocus
            aria-label="Folder name"
            value={name}
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value)
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
            <Button type="submit" disabled={name.trim() === '' || busy}>
              {busy ? 'Renaming…' : 'Rename'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
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
              ? `Moves the empty folder "${folderPath}" to the system Trash.`
              : `Moves "${folderPath}" and its ${count} ${count === 1 ? 'note' : 'notes'} to the system Trash. You can restore it from there.`}
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
