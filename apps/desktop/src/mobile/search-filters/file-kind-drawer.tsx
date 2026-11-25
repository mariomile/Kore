import type { ReactElement } from 'react'
import { FILE_KIND_FILTERS, type FileKindFilter } from '@kore/core'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { haptic } from '@/lib/haptics'
import { SettingsGroup, SettingsSelectRow } from '@/mobile/settings-list'

interface FileKindDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  current: FileKindFilter | null
  onPick: (kind: FileKindFilter | null) => void
}

/**
 * The File type badge's sheet: notes only, or one kind of the vault's files
 * (the loose ones, the files a folder page shows as cards). The sort sheet's
 * checked list; a pick applies and closes.
 */
export function FileKindDrawer({
  open,
  onOpenChange,
  current,
  onPick,
}: FileKindDrawerProps): ReactElement {
  const pick = (kind: FileKindFilter | null): void => {
    haptic('selection')
    onPick(kind)
    onOpenChange(false)
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-label="File type">
        <div className="flex h-14 shrink-0 items-end justify-center px-12 pb-1">
          <DrawerTitle className="truncate px-0 pt-0 pb-2.5 text-center text-[17px] font-semibold">
            File type
          </DrawerTitle>
        </div>
        <div className="flex flex-col gap-6 px-4 pt-4 pb-8">
          <SettingsGroup footer="A file a note embeds stays with that note.">
            <SettingsSelectRow
              label="Everything"
              selected={current === null}
              onPress={() => pick(null)}
            />
            {FILE_KIND_FILTERS.map(({ kind, label }) => (
              <SettingsSelectRow
                key={kind}
                label={label}
                selected={current === kind}
                onPress={() => pick(kind)}
              />
            ))}
          </SettingsGroup>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
