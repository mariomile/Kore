import { useMemo, useRef, useState, type ReactElement } from 'react'
import { FolderMove, Hash, Layers, Trash } from '@/components/icons'
import { errorMessage, relationValue, type NoteListEntry, type TagType } from '@reflect/core'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { toast } from '@/components/ui/toast'
import { commitNoteFrontmatter } from '@/lib/note-frontmatter'
import { folderOf, useNoteBulkActions } from '@/lib/notes/use-note-bulk-actions'
import { invalidateOnNextIndexApply } from '@/lib/tags/use-commit-note-property'
import { useGraph } from '@/providers/graph-provider'

interface AllNotesBulkBarProps {
  /** The notes the actions apply to — the current selection, dailies included. */
  paths: readonly string[]
  /** The same, minus dailies: the only notes trash will accept. */
  trashablePaths: readonly string[]
  /** Every note in the graph — the folder list is derived from their paths. */
  notes: readonly NoteListEntry[] | undefined
  /** The routed tag's schema, when it has one — enables Set property. */
  tagType?: TagType | null
  /** Open the bulk-trash confirm the screen owns. */
  onRequestTrash: () => void
  /** Run after an action fully succeeded, so the screen can clear its selection. */
  onDone: () => void
}

/** Per-type hints for the Set-property value input (default covers the rest). */
const BULK_VALUE_PLACEHOLDERS: Partial<Record<TagType['properties'][number]['type'], string>> = {
  multiselect: 'comma, separated, values',
  relations: 'Note titles, comma-separated',
  relation: 'Note title',
}

/** Parse the dialog's value input into the typed YAML value ('' clears). */
function bulkPropertyValue(
  type: TagType['properties'][number]['type'],
  raw: string,
): { ok: true; value: unknown } | { ok: false } {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { ok: true, value: undefined }
  }
  switch (type) {
    case 'number': {
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false }
    }
    case 'checkbox':
      return trimmed === 'true' || trimmed === 'false'
        ? { ok: true, value: trimmed === 'true' }
        : { ok: false }
    case 'multiselect':
    case 'relations': {
      // One comma-list grammar for both; relations wrap each entry as its
      // own `[[link]]`.
      const entries = trimmed
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '')
      if (entries.length === 0) {
        return { ok: true, value: undefined }
      }
      return { ok: true, value: type === 'relations' ? entries.map(relationValue) : entries }
    }
    case 'relation':
      return { ok: true, value: relationValue(trimmed) }
    default:
      return { ok: true, value: trimmed }
  }
}

/** The distinct folders notes actually live in, plus the root, alphabetical. */
function foldersFrom(notes: readonly NoteListEntry[] | undefined): string[] {
  const folders = new Set<string>()
  for (const note of notes ?? []) {
    const folder = folderOf(note.path)
    if (folder !== '') {
      folders.add(folder)
    }
  }
  return [...folders].sort((a, b) => a.localeCompare(b))
}

/**
 * The actions that appear once notes are selected in All Notes. Trash already
 * lived here; tag and move are the two that were missing, so a selection could
 * only ever be deleted.
 *
 * It floats over the list rather than sitting in the header, and that is
 * load-bearing: three buttons in a wrapping header grow it by a line the first
 * time a row is selected, which pushes the list down *between the two clicks
 * of a double-click* — the second click lands on a different row, or on
 * nothing. Taking the bar out of the flow makes that impossible by
 * construction instead of by fitting.
 *
 * The move target is chosen from the folders notes are *already* in, plus a
 * free-text field for a new one — the graph is a folder of markdown files, so
 * there is no folder list to read other than the one the notes imply. A folder
 * that doesn't exist yet is created by the move itself.
 */
export function AllNotesBulkBar({
  paths,
  trashablePaths,
  notes,
  tagType = null,
  onRequestTrash,
  onDone,
}: AllNotesBulkBarProps): ReactElement | null {
  const { tag, move, isRunning } = useNoteBulkActions()
  const { graph } = useGraph()
  const [tagging, setTagging] = useState(false)
  const [moving, setMoving] = useState(false)
  const [settingProperty, setSettingProperty] = useState(false)
  const [propertyRunning, setPropertyRunning] = useState(false)
  const [tagValue, setTagValue] = useState('')
  const [folderValue, setFolderValue] = useState('')
  const [propertyKey, setPropertyKey] = useState('')
  const [propertyValue, setPropertyValue] = useState('')
  const folders = useMemo(() => foldersFrom(notes), [notes])
  // Snapshots taken when a dialog opens: the actions prune the selection as
  // they land, and driving the dialog off the live one would have its count
  // change under the user mid-confirm.
  const pending = useRef<readonly string[]>([])

  if (paths.length === 0) {
    return null
  }

  const openTagging = (): void => {
    pending.current = paths
    setTagValue('')
    setTagging(true)
  }
  const openMoving = (): void => {
    pending.current = paths
    setFolderValue('')
    setMoving(true)
  }
  const openSetProperty = (): void => {
    pending.current = paths
    setPropertyKey(tagType?.properties[0]?.key ?? '')
    setPropertyValue('')
    setSettingProperty(true)
  }

  const selectedProperty = tagType?.properties.find((entry) => entry.key === propertyKey) ?? null
  const parsedBulkValue =
    selectedProperty === null
      ? ({ ok: false } as const)
      : bulkPropertyValue(selectedProperty.type, propertyValue)

  const runSetProperty = async (): Promise<void> => {
    if (graph === null || selectedProperty === null || !parsedBulkValue.ok) {
      return
    }
    setPropertyRunning(true)
    try {
      for (const path of pending.current) {
        await commitNoteFrontmatter(
          path,
          { properties: { [selectedProperty.key]: parsedBulkValue.value } },
          graph.generation,
        )
      }
      invalidateOnNextIndexApply()
      setSettingProperty(false)
      onDone()
    } catch (error) {
      toast.add({
        type: 'error',
        title: "Couldn't set the property",
        description: errorMessage(error),
      })
    } finally {
      setPropertyRunning(false)
    }
  }
  const finish = (ok: boolean, close: (open: boolean) => void): void => {
    close(false)
    if (ok) {
      onDone()
    }
  }

  return (
    <>
      {/* Positioned against the screen root, which declares `relative` for
          exactly this — see the note beside it in all-notes-screen.tsx. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center">
        <div className="animate-in fade-in-0 slide-in-from-bottom-2 pointer-events-auto flex items-center gap-1.5 rounded-full border border-border bg-popover p-1.5 pl-3.5 shadow-pop duration-150 ease-swift">
          <span className="mr-1 text-xs tabular-nums text-text-secondary">
            {paths.length} selected
          </span>
          <Button
            type="button"
            variant="ghost"
            aria-label={`Tag (${paths.length})`}
            disabled={isRunning}
            onClick={openTagging}
            className="text-text-secondary"
          >
            <Hash aria-hidden className="size-3.5" />
            <span>Tag</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={`Move (${paths.length})`}
            disabled={isRunning}
            onClick={openMoving}
            className="text-text-secondary"
          >
            <FolderMove aria-hidden className="size-3.5" />
            <span>Move</span>
          </Button>
          {tagType !== null && tagType.properties.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              aria-label={`Set property (${paths.length})`}
              disabled={isRunning || propertyRunning}
              onClick={openSetProperty}
              className="text-text-secondary"
            >
              <Layers aria-hidden className="size-3.5" />
              <span>Property</span>
            </Button>
          ) : null}
          {trashablePaths.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              aria-label={`Trash (${trashablePaths.length})`}
              disabled={isRunning}
              onClick={onRequestTrash}
              className="text-text-secondary hover:text-destructive"
            >
              <Trash aria-hidden className="size-3.5" />
              <span>Trash</span>
              <span
                aria-hidden
                className="flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive/10 px-1 text-[10px] font-semibold leading-none tabular-nums text-destructive"
              >
                {trashablePaths.length}
              </span>
            </Button>
          ) : null}
        </div>
      </div>

      <Dialog open={tagging} onOpenChange={isRunning ? () => {} : setTagging}>
        <DialogContent>
          <DialogTitle>
            Tag {pending.current.length} {pending.current.length === 1 ? 'note' : 'notes'}
          </DialogTitle>
          <DialogDescription>
            The tag is appended to each note that doesn&rsquo;t already carry it. Notes with unsaved
            changes are left alone.
          </DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void tag(pending.current, tagValue).then((outcome) => {
                finish(outcome.ok, setTagging)
              })
            }}
          >
            <Input
              autoFocus
              aria-label="Tag name"
              placeholder="reading"
              value={tagValue}
              onChange={(event) => setTagValue(event.target.value)}
            />
            <DialogFooter className="mt-4">
              <DialogClose
                render={
                  <Button type="button" variant="ghost" disabled={isRunning}>
                    Cancel
                  </Button>
                }
              />
              <Button type="submit" disabled={isRunning || tagValue.trim() === ''}>
                Tag
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={settingProperty} onOpenChange={propertyRunning ? () => {} : setSettingProperty}>
        <DialogContent>
          <DialogTitle>
            Set a property on {pending.current.length}{' '}
            {pending.current.length === 1 ? 'note' : 'notes'}
          </DialogTitle>
          <DialogDescription>
            Writes the value into each note&rsquo;s frontmatter. An empty value clears the property
            instead.
          </DialogDescription>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void runSetProperty()
            }}
          >
            <Select
              value={propertyKey}
              items={Object.fromEntries(
                (tagType?.properties ?? []).map((entry) => [entry.key, entry.name]),
              )}
              onValueChange={(value) => setPropertyKey(value ?? '')}
            >
              <SelectTrigger aria-label="Property">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(tagType?.properties ?? []).map((entry) => (
                  <SelectItem key={entry.key} value={entry.key}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedProperty?.type === 'checkbox' ? (
              <Select
                value={propertyValue}
                onValueChange={(value) => setPropertyValue(value ?? '')}
              >
                <SelectTrigger aria-label="Value">
                  <SelectValue placeholder="Keep empty to clear" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Checked</SelectItem>
                  <SelectItem value="false">Unchecked</SelectItem>
                </SelectContent>
              </Select>
            ) : selectedProperty?.type === 'select' ? (
              <Select
                value={propertyValue}
                onValueChange={(value) => setPropertyValue(value ?? '')}
              >
                <SelectTrigger aria-label="Value">
                  <SelectValue placeholder="Keep empty to clear" />
                </SelectTrigger>
                <SelectContent>
                  {(selectedProperty.options ?? []).map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                aria-label="Value"
                type={
                  selectedProperty?.type === 'number'
                    ? 'number'
                    : selectedProperty?.type === 'date'
                      ? 'date'
                      : 'text'
                }
                placeholder={
                  (selectedProperty && BULK_VALUE_PLACEHOLDERS[selectedProperty.type]) ??
                  'Empty clears the property'
                }
                value={propertyValue}
                onChange={(event) => setPropertyValue(event.target.value)}
              />
            )}
            <DialogFooter>
              <DialogClose
                render={
                  <Button type="button" variant="ghost" disabled={propertyRunning}>
                    Cancel
                  </Button>
                }
              />
              <Button type="submit" disabled={propertyRunning || !parsedBulkValue.ok}>
                {propertyValue.trim() === '' ? 'Clear property' : 'Set property'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={moving} onOpenChange={isRunning ? () => {} : setMoving}>
        <DialogContent>
          <DialogTitle>
            Move {pending.current.length} {pending.current.length === 1 ? 'note' : 'notes'}
          </DialogTitle>
          <DialogDescription>
            Each note keeps its filename. Links that point at it are retargeted, and an open editor
            follows the file.
          </DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void move(pending.current, folderValue).then((outcome) => {
                finish(outcome.ok, setMoving)
              })
            }}
          >
            <Input
              autoFocus
              aria-label="Destination folder"
              placeholder="Graph root"
              list="all-notes-folders"
              value={folderValue}
              onChange={(event) => setFolderValue(event.target.value)}
            />
            {/* The folders notes already live in, as completions — a new name
                typed here is created by the move. */}
            <datalist id="all-notes-folders">
              {folders.map((folder) => (
                <option key={folder} value={folder} />
              ))}
            </datalist>
            <DialogFooter className="mt-4">
              <DialogClose
                render={
                  <Button type="button" variant="ghost" disabled={isRunning}>
                    Cancel
                  </Button>
                }
              />
              <Button type="submit" disabled={isRunning}>
                Move
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
