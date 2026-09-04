import { useCallback, useState } from 'react'
import {
  bodyHasTag,
  convertTaggedLineToNote,
  isDaily,
  readNote,
  splitFrontmatter,
  stripLeadingHeading,
  writeNote,
} from '@reflect/core'
import { createTypedCollectionNote } from '@/lib/tags/create-collection-note'
import { useTagType } from '@/hooks/use-tag-type'
import { useTemplateValues } from '@/hooks/use-template-values'
import { useGraph } from '@/providers/graph-provider'
import { useRouter } from '@/routing/router'
import type { NoteEditorHandle } from './note-editor'
import { useTagNavigation } from './use-tag-navigation'

export interface TagActionsMenuState {
  readonly tag: string
  /** Anchor coordinates in viewport space, from the originating click. */
  readonly x: number
  readonly y: number
}

/** The click/key event's viewport position, or the target element's own
 * corner when the gesture carries no coordinates (a keyboard activation). */
function anchorPointFromEvent(event: MouseEvent | KeyboardEvent): { x: number; y: number } {
  if (event instanceof MouseEvent) {
    return { x: event.clientX, y: event.clientY }
  }
  const rect = (event.target instanceof HTMLElement ? event.target : null)?.getBoundingClientRect()
  return rect ? { x: rect.left, y: rect.bottom } : { x: 0, y: 0 }
}

/** Overwrite `path`'s leading H1 with `title`, keeping the rest of the body. */
async function retitleNote(path: string, title: string, generation: number): Promise<void> {
  const source = await readNote(path, generation)
  const { raw, body } = splitFrontmatter(source)
  const nextBody = `# ${title}\n${stripLeadingHeading(body)}`
  const nextSource = raw === null ? nextBody : `---\n${raw}\n---\n${nextBody}`
  await writeNote(path, nextSource, generation)
}

/**
 * The Tana gesture (TDR 0005): clicking a `#tag` inside a daily note opens a
 * small menu instead of navigating straight to the tag's collection — "Open
 * #tag" keeps the old behavior, and "Turn this line into a #tag note" births
 * a real note from the clicked line and leaves a wiki link + the tag behind,
 * so the daily stays a member of the collection. Non-daily notes keep the
 * plain click-to-navigate behavior: {@link onTagClick} skips the menu
 * entirely there.
 */
export function useTagActions(
  path: string,
  getEditorHandle: () => NoteEditorHandle | null,
  onEditorChange: (markdown: string) => void,
): {
  menu: TagActionsMenuState | null
  closeMenu: () => void
  onTagClick: (tag: string, event: MouseEvent | KeyboardEvent) => void
  openTag: (tag: string) => void
  convertLineToNote: () => Promise<void>
} {
  const { graph } = useGraph()
  const { navigate } = useRouter()
  const navigateToTag = useTagNavigation()
  const resolveTemplateValues = useTemplateValues()
  const [menu, setMenu] = useState<TagActionsMenuState | null>(null)
  const tagType = useTagType(menu?.tag ?? null)
  const daily = isDaily(path)

  const closeMenu = useCallback(() => setMenu(null), [])

  const onTagClick = useCallback(
    (tag: string, event: MouseEvent | KeyboardEvent) => {
      if (!daily) {
        navigateToTag(tag)
        return
      }
      setMenu({ tag, ...anchorPointFromEvent(event) })
    },
    [daily, navigateToTag],
  )

  const openTag = useCallback(
    (tag: string) => {
      closeMenu()
      navigateToTag(tag)
    },
    [closeMenu, navigateToTag],
  )

  const convertLineToNote = useCallback(async () => {
    const active = menu
    const handle = getEditorHandle()
    if (active === null || handle === null || graph === null) {
      return
    }
    const source = handle.getMarkdown()
    const { raw, body } = splitFrontmatter(source)
    const lines = body.split('\n')
    const lineIndex = lines.findIndex((line) => bodyHasTag(line, active.tag))
    closeMenu()
    if (lineIndex === -1) {
      return
    }
    const { title, replacementLine } = convertTaggedLineToNote(lines[lineIndex]!, active.tag)
    const templateValues = await resolveTemplateValues(null)
    const notePath = await createTypedCollectionNote(
      active.tag,
      graph.generation,
      {},
      tagType,
      templateValues,
    )
    await retitleNote(notePath, title, graph.generation)
    lines[lineIndex] = replacementLine
    const nextBody = lines.join('\n')
    const nextSource = raw === null ? nextBody : `---\n${raw}\n---\n${nextBody}`
    handle.setMarkdown(nextSource)
    onEditorChange(nextSource)
    navigate({ kind: 'note', path: notePath })
  }, [
    menu,
    getEditorHandle,
    graph,
    closeMenu,
    resolveTemplateValues,
    tagType,
    onEditorChange,
    navigate,
  ])

  return { menu, closeMenu, onTagClick, openTag, convertLineToNote }
}
