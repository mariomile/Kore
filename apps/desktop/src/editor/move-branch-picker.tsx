import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Priority } from '@meowdown/core'
import { definePlugin } from '@prosekit/core'
import { Plugin } from '@prosekit/pm/state'
import type { EditorView } from '@prosekit/pm/view'
import { useExtension, useKeymap } from '@meowdown/react'
import { suggestWikiTargets, type WikiSuggestion } from '@reflect/core'
import { ArrowUturnRight } from '@/components/icons'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { branchAt, moveBranch, type MoveDestination } from './move-branch'
import {
  hasMoveBranch,
  MOVE_BRANCH_BINDING,
  noteMoveBranchFocus,
  openMoveBranch,
  registerMoveBranchOpener,
  unregisterMoveBranchOpener,
} from './move-branch-opener'

/** Whether the block at `pos` can be moved from this editor (the block menu's check). */
export function canMoveBranch(view: EditorView, pos?: number): boolean {
  return hasMoveBranch(view) && branchAt(view.state, pos) !== null
}

interface MoveBranchProps {
  readonly notePath: string
  /** How links name this note; null (an untitled note) leaves the move off. */
  readonly linkTarget: string | null
  readonly generation: number | null
  /** Opens a note, for the confirmation's "Open". */
  readonly openNote?: ((path: string) => void) | undefined
}

interface PickerState {
  readonly view: EditorView
  readonly pos: number | undefined
}

function useSuggestions(query: string | null): readonly WikiSuggestion[] {
  const [results, setResults] = useState<readonly WikiSuggestion[]>([])
  useEffect(() => {
    if (query === null) {
      return
    }
    let live = true
    suggestWikiTargets(query.trim(), 8).then(
      (found) => {
        if (live) {
          setResults(found)
        }
      },
      () => {
        if (live) {
          setResults([])
        }
      },
    )
    return () => {
      live = false
    }
  }, [query])
  return results
}

/**
 * ⌘⇧M (Plan 33 C2): move the caret's branch to the end of a picked note. The
 * picker searches note titles; the move itself is `moveBranch`. Mounted as a
 * NoteEditor child.
 */
export function MoveBranch({
  notePath,
  linkTarget,
  generation,
  openNote,
}: MoveBranchProps): ReactElement | null {
  const [picker, setPicker] = useState<PickerState | null>(null)
  const [query, setQuery] = useState('')
  const enabled = linkTarget !== null && generation !== null
  const latest = useRef({ enabled, open: setPicker })
  latest.current = { enabled, open: setPicker }

  useExtension(
    useMemo(
      () =>
        definePlugin(
          new Plugin({
            view: (view) => {
              registerMoveBranchOpener(view, (pos) => {
                if (!latest.current.enabled || branchAt(view.state, pos) === null) {
                  return false
                }
                setQuery('')
                latest.current.open({ view, pos })
                return true
              })
              return {
                destroy: () => unregisterMoveBranchOpener(view),
              }
            },
            props: {
              handleDOMEvents: {
                focus: (view) => {
                  noteMoveBranchFocus(view)
                  return false
                },
              },
            },
          }),
        ),
      [],
    ),
  )
  useKeymap(
    useMemo(
      () => ({
        [MOVE_BRANCH_BINDING]: (_state, _dispatch, view) =>
          view !== undefined && openMoveBranch(view),
      }),
      [],
    ),
    { priority: Priority.high },
  )

  const suggestions = useSuggestions(picker === null ? null : query)
  const choices = suggestions.filter(
    (suggestion): suggestion is WikiSuggestion & { path: string } =>
      suggestion.path !== null && suggestion.path !== notePath,
  )

  if (picker === null) {
    return null
  }
  const close = (): void => {
    setPicker(null)
    picker.view.focus()
  }
  const pick = (choice: WikiSuggestion & { path: string }): void => {
    setPicker(null)
    if (linkTarget === null || generation === null) {
      return
    }
    const destination: MoveDestination = {
      path: choice.path,
      target: choice.target,
      title: choice.title,
    }
    picker.view.focus()
    void moveBranch({
      view: picker.view,
      notePath,
      sourceTarget: linkTarget,
      destination,
      generation,
      pos: picker.pos,
      open: openNote === undefined ? undefined : () => openNote(choice.path),
    })
  }

  return (
    <CommandDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          close()
        }
      }}
      title="Move to note"
      description="Choose the note this block moves to"
    >
      <Command shouldFilter={false}>
        <CommandInput placeholder="Move to…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>No notes found</CommandEmpty>
          {choices.length > 0 ? (
            <CommandGroup>
              {choices.map((choice) => (
                <CommandItem key={choice.path} value={choice.path} onSelect={() => pick(choice)}>
                  <ArrowUturnRight aria-hidden className="text-text-muted" />
                  <span className="truncate">{choice.alias ?? choice.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
