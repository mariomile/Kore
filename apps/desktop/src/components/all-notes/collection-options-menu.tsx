import { useRef, type ReactElement } from 'react'
import type { CollectionEntry, TagType } from '@reflect/core'
import { Download, Inbox, MoreHorizontal } from '@/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useGraph } from '@/providers/graph-provider'
import { runCollectionExport } from './collection-export'
import { importCollectionCsvFile } from './collection-import'

interface CollectionOptionsMenuProps {
  tag: string
  type: TagType
  entries: readonly CollectionEntry[]
}

/**
 * The collection toolbar's `...`: Import CSV and Export CSV, the gestures
 * that used to sit as their own header icons.
 */
export function CollectionOptionsMenu({
  tag,
  type,
  entries,
}: CollectionOptionsMenuProps): ReactElement {
  const { graph } = useGraph()
  const inputRef = useRef<HTMLInputElement | null>(null)

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file !== undefined && graph !== null) {
            void importCollectionCsvFile(tag, type, graph.generation, file)
          }
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Collection options"
              title="Collection options"
              className="app-icon-button text-text-muted hover:text-text"
            >
              <MoreHorizontal aria-hidden className="size-3.5" />
            </button>
          }
        />
        <DropdownMenuContent align="end" sideOffset={6} className="min-w-40">
          <DropdownMenuItem
            onClick={() => {
              inputRef.current?.click()
            }}
          >
            <Inbox aria-hidden className="size-3.5" />
            Import CSV
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              void runCollectionExport(tag, type, entries)
            }}
          >
            <Download aria-hidden className="size-3.5" />
            Export CSV
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
