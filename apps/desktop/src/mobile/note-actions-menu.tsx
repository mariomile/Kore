import { useState, type ReactElement } from 'react'
import {
  FolderMove,
  Hash,
  Image,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pin,
  PinOff,
  Share,
  Smile,
  Trash,
} from '@/components/icons'
import {
  errorMessage,
  isDaily,
  isTemplatePath,
  parseNoteAppearanceFromSource,
  weekFromWeeklyPath,
  type NoteAppearance,
} from '@kore/core'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { useNoteRowState } from '@/hooks/use-note-row'
import { usePinnedNotes } from '@/hooks/use-pinned-notes'
import { readNoteSource } from '@/lib/note-frontmatter'
import { toggleNotePinned } from '@/lib/note-pin'
import { toggleNotePrivate } from '@/lib/note-private'
import { useBridgedNoteToggle } from '@/lib/notes/use-bridged-note-toggle'
import { MoveToDrawer } from '@/mobile/move-to-drawer'
import { NoteAppearanceDrawer, type NoteAppearancePart } from '@/mobile/note-appearance-drawer'
import { NoteDeleteDialog } from '@/mobile/note-delete-dialog'
import { shareNote } from '@/mobile/share'
import { useGraph } from '@/providers/graph-provider'

interface NoteActionsMenuProps {
  /** Graph-relative path of the note the actions operate on. */
  path: string
  /** Called after the note is deleted, so the screen can navigate away. */
  onDeleted: () => void
  /** Open the note's native Add tag sheet (omitted on template notes). */
  onOpenTagPicker?: () => void
}

/**
 * The note screen's "⋯" action sheet (Plan 19): pin/unpin, lock/unlock from
 * external services, share, and delete-to-trash. Pin reflects the index's
 * pinned set; privacy reflects the note's indexed `private: true` flag,
 * bridged by the last toggle result while the mobile write echo and index
 * catch up. {@link shareNote} hands the note's body to the OS share sheet via
 * the Web Share API (`navigator.share`); delete confirms first (it's
 * destructive, even if recoverable from `.kore/trash/`) and routes through
 * {@link deleteOpenNote} so the open session is discarded rather than flushed.
 */
export function NoteActionsMenu({
  path,
  onDeleted,
  onOpenTagPicker,
}: NoteActionsMenuProps): ReactElement {
  const { graph } = useGraph()
  const isPinned = usePinnedNotes().some((note) => note.path === path)
  const { row: noteRow, settled: privacyReady } = useNoteRowState(path)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [moving, setMoving] = useState(false)
  // Daily and weekly notes are named by their date, with no icon or cover
  // (the Mac header offers none either). Read as the sheet opens, so the
  // rows say Add or Change and the sheet below knows what it can remove.
  const periodic = isDaily(path) || weekFromWeeklyPath(path) !== null
  const [appearance, setAppearance] = useState<NoteAppearance | null>(null)
  const [editing, setEditing] = useState<NoteAppearancePart | null>(null)
  const {
    isActive: isPrivate,
    isToggling: isTogglingPrivate,
    toggleActive: togglePrivate,
  } = useBridgedNoteToggle({
    path,
    indexActive: noteRow?.isPrivate ?? false,
    toggle: toggleNotePrivate,
    failureLabel: (active) => (active ? 'Unlocking note' : 'Locking note'),
  })
  const privacyActionLabel = !privacyReady
    ? 'Loading privacy…'
    : isPrivate
      ? 'Unlock note'
      : 'Lock note'

  const pin = (): void => {
    if (graph !== null) {
      void toggleNotePinned(path, graph.generation).catch(() => {})
    }
  }

  const share = (): void => {
    void shareNote(path).catch((cause) => console.error('share failed:', errorMessage(cause)))
  }

  return (
    <>
      <Drawer
        open={actionsOpen}
        onOpenChange={(open) => {
          setActionsOpen(open)
          if (open && !periodic) {
            void readNoteSource(path)
              .then((source) => setAppearance(parseNoteAppearanceFromSource(source)))
              .catch(() => setAppearance(parseNoteAppearanceFromSource('')))
          }
        }}
      >
        <DrawerTrigger
          render={
            <Button variant="ghost" size="icon" className="size-11" aria-label="Note actions" />
          }
        >
          <MoreHorizontal />
        </DrawerTrigger>
        <DrawerContent>
          <DrawerTitle className="sr-only">Note actions</DrawerTitle>
          <div className="flex flex-col gap-1 p-4">
            {onOpenTagPicker !== undefined && !isTemplatePath(path) ? (
              <Button
                variant="ghost"
                size="lg"
                className="h-12 justify-start gap-3 text-base"
                onClick={() => {
                  setActionsOpen(false)
                  onOpenTagPicker()
                }}
              >
                <Hash />
                Add tag
              </Button>
            ) : null}
            {appearance === null || periodic ? null : (
              <>
                <Button
                  variant="ghost"
                  size="lg"
                  className="h-12 justify-start gap-3 text-base"
                  onClick={() => {
                    setActionsOpen(false)
                    setEditing('icon')
                  }}
                >
                  <Smile />
                  {appearance.icon === null ? 'Add icon' : 'Change icon'}
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  className="h-12 justify-start gap-3 text-base"
                  onClick={() => {
                    setActionsOpen(false)
                    setEditing('cover')
                  }}
                >
                  <Image />
                  {appearance.coverSrc === null ? 'Add cover' : 'Change cover'}
                </Button>
              </>
            )}
            {isDaily(path) ? null : (
              <Button
                variant="ghost"
                size="lg"
                className="h-12 justify-start gap-3 text-base"
                onClick={() => {
                  setActionsOpen(false)
                  setMoving(true)
                }}
              >
                <FolderMove />
                Move to…
              </Button>
            )}
            <Button
              variant="ghost"
              size="lg"
              className="h-12 justify-start gap-3 text-base"
              onClick={() => {
                pin()
                setActionsOpen(false)
              }}
            >
              {isPinned ? <PinOff /> : <Pin />}
              {isPinned ? 'Unpin' : 'Pin'}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="h-12 justify-start gap-3 text-base"
              disabled={!privacyReady || isTogglingPrivate}
              onClick={() => {
                void togglePrivate()
                setActionsOpen(false)
              }}
            >
              {privacyReady && isPrivate ? <LockOpen aria-hidden /> : <Lock aria-hidden />}
              {privacyActionLabel}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="h-12 justify-start gap-3 text-base"
              onClick={() => {
                share()
                setActionsOpen(false)
              }}
            >
              <Share />
              Share
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="h-12 justify-start gap-3 text-base text-destructive hover:text-destructive"
              onClick={() => {
                setActionsOpen(false)
                setConfirmingDelete(true)
              }}
            >
              <Trash />
              Delete
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      {editing !== null && appearance !== null ? (
        <NoteAppearanceDrawer
          path={path}
          part={editing}
          current={appearance}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {/* Mounted only while moving: the picker reads the whole folder tree. */}
      {moving ? (
        <MoveToDrawer target={{ kind: 'note', path }} onClose={() => setMoving(false)} />
      ) : null}
      <NoteDeleteDialog
        path={path}
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        onDeleted={onDeleted}
      />
    </>
  )
}
