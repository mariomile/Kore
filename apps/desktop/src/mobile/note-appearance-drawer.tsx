import type { ReactElement } from 'react'
import { noteIconValue, type NoteAppearance } from '@kore/core'
import { IconPickerPanel } from '@/components/icon-picker-panel'
import { NoteCoverPanel } from '@/components/notes/note-cover-picker'
import { useNoteAppearanceEdit } from '@/components/notes/use-note-appearance-edit'
import { Trash } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerBody, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { useAssetPersistence } from '@/editor/use-asset-persistence'
import { haptic } from '@/lib/haptics'
import { useGraph } from '@/providers/graph-provider'

export type NoteAppearancePart = 'icon' | 'cover'

interface NoteAppearanceDrawerProps {
  path: string
  part: NoteAppearancePart
  /** The note's icon and cover as the sheet opened. */
  current: NoteAppearance
  onClose: () => void
}

/**
 * The iPhone's way to set a note's icon or cover, opened from the note's
 * "⋯" sheet: touch has no hover to reveal the Mac header's controls. The
 * same panels as the Mac's popovers, in a sheet; "Remove" shows only when
 * the note has an icon or cover to remove.
 */
export function NoteAppearanceDrawer({
  path,
  part,
  current,
  onClose,
}: NoteAppearanceDrawerProps): ReactElement {
  const { graph } = useGraph()
  const generation = graph?.generation ?? null
  const edit = useNoteAppearanceEdit(path, generation)
  const { saveFile } = useAssetPersistence(generation, path)
  const finish = (): void => {
    haptic('success')
    onClose()
  }

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DrawerContent>
        <DrawerTitle className="truncate px-12 text-center text-[17px] font-semibold">
          {part === 'icon' ? 'Icon' : 'Cover'}
        </DrawerTitle>
        <DrawerBody className="flex flex-col gap-3 px-4 pt-4 pb-6">
          {edit === null ? null : part === 'icon' ? (
            <IconPickerPanel
              value={current.icon === null ? null : noteIconValue(current.icon)}
              onPick={(icon) => {
                edit.setIcon(icon)
                finish()
              }}
            />
          ) : (
            <>
              <NoteCoverPanel
                upload={saveFile}
                touch
                onPick={(cover) => {
                  edit.setCover(cover)
                  finish()
                }}
              />
              {current.coverSrc !== null ? (
                <Button
                  variant="ghost"
                  size="lg"
                  className="h-12 justify-start gap-3 text-base text-destructive hover:text-destructive"
                  onClick={() => {
                    edit.setCover(null)
                    finish()
                  }}
                >
                  <Trash />
                  Remove cover
                </Button>
              ) : null}
            </>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  )
}
