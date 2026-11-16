import type { ReactElement } from 'react'
import { foldTag, tagDisplayName, type NoteTagFacet } from '@kore/core'
import { Check, ChevronRight } from '@/components/icons'
import { TagIcon } from '@/components/tags/tag-icon'
import { Drawer, DrawerBody, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { useTagIcons } from '@/hooks/use-tag-icons'
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
  /** Open a type's page, its collection (display casing). */
  onOpen: (tag: string) => void
}

/**
 * The Types sheet: every tag with its icon and note count. A row opens the
 * type's page (its table, board and gallery, like a Craft collection); the
 * round control at the end narrows the Notes list to that type instead, and
 * several narrow it further (ANDed, as on V1's tag modal).
 */
export function TagFilterDrawer({
  open,
  onOpenChange,
  facets,
  selected,
  onToggle,
  onOpen,
}: TagFilterDrawerProps): ReactElement {
  const icons = useTagIcons()
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerTitle>Types</DrawerTitle>
        <DrawerBody className="px-4 pb-2">
          <p className="px-2 pb-2 text-[13px] text-text-muted">
            Open a type, or tick it to filter your notes.
          </p>
          <div className="flex flex-col">
            {facets.length === 0 && (
              <p className="py-6 text-center text-sm text-text-muted">No types yet</p>
            )}
            {facets.map((facet) => {
              const key = foldTag(facet.tag)
              const isSelected = selected.includes(key)
              const name = tagDisplayName(facet.tag)
              return (
                <div key={key} className="flex h-12 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onOpen(facet.tag)}
                    className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-xl px-2 text-left text-base active:bg-surface-hover"
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center">
                      <TagIcon
                        icon={icons.get(key)}
                        className="size-[18px] text-text-muted"
                        emojiClassName="text-[18px]"
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <span className="text-[13px] tabular-nums text-text-muted">{facet.count}</span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-text-muted" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Filter notes by #${key}`}
                    aria-pressed={isSelected}
                    onClick={() => onToggle(key)}
                    className="-mr-2 flex size-11 shrink-0 items-center justify-center"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'flex size-[22px] items-center justify-center rounded-full border-[1.5px] transition-colors duration-150 motion-reduce:transition-none',
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border-strong text-transparent',
                      )}
                    >
                      <Check className="size-3.5" strokeWidth={2.25} />
                    </span>
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
