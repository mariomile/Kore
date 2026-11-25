import { useState, type ReactElement, type ReactNode } from 'react'
import { LayoutTemplate, Note, NoteEdit, NotePlus } from '@/components/icons'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useWikiSuggestions } from '@/hooks/use-wiki-suggestions'
import { cn } from '@/lib/utils'

/** The look of every floating control box on the board (zoom, add, a selection's menu). */
export const CANVAS_TOOL_BOX =
  'flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 shadow-sm'

/** The floating box the board's controls sit in (zoom, add). */
export function CanvasToolBox({
  className,
  children,
}: {
  className: string
  children: ReactNode
}): ReactElement {
  return <div className={cn('absolute bottom-3', CANVAS_TOOL_BOX, className)}>{children}</div>
}

export function CanvasToolButton({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string
  onClick: () => void
  /** Set for a toggle (a selection's current shape); left out for a plain action. */
  pressed?: boolean
  children: ReactElement
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'flex size-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text',
        pressed === true && 'bg-surface-active text-text',
      )}
    >
      {children}
    </button>
  )
}

interface CanvasAddToolsProps {
  onAddNote: (path: string) => void
  onAddText: () => void
  onAddGroup: () => void
}

/** Add a note card (picked by title), a text card or a group: the Mac's editable board only. */
export function CanvasAddTools({
  onAddNote,
  onAddText,
  onAddGroup,
}: CanvasAddToolsProps): ReactElement {
  const [query, setQuery] = useState<string | null>(null)
  const suggestions = useWikiSuggestions(query)
  const close = (): void => {
    setQuery(null)
  }
  return (
    <CanvasToolBox className="left-3">
      <CanvasToolButton
        label="Add note"
        onClick={() => {
          setQuery('')
        }}
      >
        <NotePlus aria-hidden className="size-3.5" />
      </CanvasToolButton>
      <CanvasToolButton label="Add text card" onClick={onAddText}>
        <NoteEdit aria-hidden className="size-3.5" />
      </CanvasToolButton>
      <CanvasToolButton label="Add group" onClick={onAddGroup}>
        <LayoutTemplate aria-hidden className="size-3.5" />
      </CanvasToolButton>
      <CommandDialog
        open={query !== null}
        onOpenChange={(open) => {
          if (!open) {
            close()
          }
        }}
        title="Add note"
        description="Choose the note to put on the canvas"
      >
        <Command shouldFilter={false}>
          <CommandInput placeholder="Add note…" value={query ?? ''} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No notes found</CommandEmpty>
            <CommandGroup>
              {suggestions.map((suggestion) =>
                suggestion.path === null ? null : (
                  <CommandItem
                    key={suggestion.path}
                    value={suggestion.path}
                    onSelect={() => {
                      close()
                      onAddNote(suggestion.path!)
                    }}
                  >
                    <Note aria-hidden className="text-text-muted" />
                    <span className="truncate">{suggestion.alias ?? suggestion.title}</span>
                  </CommandItem>
                ),
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </CanvasToolBox>
  )
}
