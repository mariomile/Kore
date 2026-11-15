import type { ReactElement } from 'react'
import { Check, Settings } from '@/components/icons'
import { foldTag, type NoteTagFacet } from '@kore/core'
import { Drawer, DrawerBody, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'

interface TagFilterDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Every tag in the graph (display casing + note count). */
  facets: NoteTagFacet[]
  /** The selected folded tag keys. */
  selected: string[]
  /** Toggle one folded tag key in or out of the selection. */
  onToggle: (tagKey: string) => void
  /** Open a type's configuration (display casing). */
  onConfigure: (tag: string) => void
}

/**
 * The Tags badge's multi-select picker (V1's tag modal as a bottom sheet):
 * every tag with its note count, checkmarks on the selected set. Selection is
 * ANDed — each added tag narrows the list further. Each row's gear opens
 * the type's configuration, the phone's door to a type's fields.
 */
export function TagFilterDrawer({
  open,
  onOpenChange,
  facets,
  selected,
  onToggle,
  onConfigure,
}: TagFilterDrawerProps): ReactElement {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerTitle>Types</DrawerTitle>
        <DrawerBody className="px-4">
          <div className="flex flex-col">
            {facets.length === 0 && (
              <p className="py-6 text-center text-sm text-text-muted">No types yet</p>
            )}
            {facets.map((facet) => {
              const key = foldTag(facet.tag)
              const isSelected = selected.includes(key)
              return (
                <div
                  key={key}
                  className="flex h-12 items-center border-b border-border last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => onToggle(key)}
                    className="flex h-full min-w-0 flex-1 items-center gap-3 text-left text-base"
                  >
                    <span className={cn('min-w-0 flex-1 truncate', isSelected && 'font-medium')}>
                      #{facet.tag}
                    </span>
                    <span className="text-xs text-text-muted">{facet.count}</span>
                    {isSelected && <Check className="size-4 text-primary" />}
                  </button>
                  <button
                    type="button"
                    aria-label={`Configure #${key}`}
                    onClick={() => onConfigure(facet.tag)}
                    className="-mr-2 flex size-11 shrink-0 items-center justify-center text-text-muted"
                  >
                    <Settings aria-hidden className="size-4" />
                  </button>
                </div>
              )
            })}
          </div>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  )
}
