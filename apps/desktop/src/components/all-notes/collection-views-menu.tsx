import { useState, type ReactElement } from 'react'
import type { SavedCollectionView } from '@reflect/core'
import { Bookmark, Close } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface CollectionViewsMenuProps {
  views: readonly SavedCollectionView[]
  onApply: (view: SavedCollectionView) => void
  onSave: (name: string) => void
  onDelete: (id: string) => void
}

/**
 * Saved collection views (TDR 0005): named bundles of view mode + sort +
 * grouping + filters, per tag. Applying one restores the whole lens; saving
 * captures whatever is on screen right now. The live filters stay ephemeral
 * — a keeper gets a name here.
 */
export function CollectionViewsMenu({
  views,
  onApply,
  onSave,
  onDelete,
}: CollectionViewsMenuProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  const save = (): void => {
    const trimmed = name.trim()
    if (trimmed === '') {
      return
    }
    onSave(trimmed)
    setName('')
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setName('')
        }
      }}
    >
      <PopoverTrigger
        aria-label="Saved views"
        aria-pressed={views.length > 0}
        title="Saved views"
        className={cn(
          'app-icon-button hover:text-text',
          views.length > 0 ? 'text-text-secondary' : 'text-text-muted',
        )}
      >
        <Bookmark aria-hidden className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-64 p-1">
        {views.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-text-muted">
            No saved views yet — set up a sort, grouping, or filters, then save them here.
          </p>
        ) : (
          views.map((view) => (
            <div key={view.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  onApply(view)
                  setOpen(false)
                }}
                className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-hover"
              >
                <span className="min-w-0 flex-1 truncate text-left">{view.name}</span>
                <span className="shrink-0 text-xs text-text-muted">{view.view}</span>
              </button>
              <button
                type="button"
                aria-label={`Delete view ${view.name}`}
                onClick={() => onDelete(view.id)}
                className="flex size-5 shrink-0 items-center justify-center rounded text-text-muted hover:text-text-secondary"
              >
                <Close aria-hidden className="size-3" />
              </button>
            </div>
          ))
        )}
        <div className="mt-1 flex gap-1.5 border-t border-border p-1.5">
          <Input
            aria-label="View name"
            value={name}
            placeholder="Save current view as…"
            className="h-7 flex-1 text-sm"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                save()
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label="Save view"
            disabled={name.trim() === ''}
            onClick={save}
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
