import { useEffect, useMemo, type ReactElement } from 'react'
import { definePlugin } from '@prosekit/core'
import { docToMarkdown } from '@meowdown/core'
import { useEditor, useExtension } from '@meowdown/react'
import { gitBlame, lineAuthors } from '@reflect/core'
import {
  LINE_AUTHORS_DOC_CHANGED,
  LINE_AUTHORS_READY,
  createLineAuthorsPlugin,
  setLineAuthors,
} from './line-authors-plugin'
import { whenEditorMounted } from './when-editor-mounted'

/** Quiet time after the last edit before blaming again. */
const REBLAME_AFTER_EDIT_MS = 2000
/** The backup commits on its own cadence; look again this often while shown. */
const REBLAME_EVERY_MS = 60_000

interface LineAuthorShadingProps {
  /** Off (the default setting) mounts nothing: no blame runs at all. */
  enabled: boolean
  path: string
  generation: number | null
  /** The note's exact frontmatter bytes; blamed with the body so lines match the file. */
  header: string
}

/**
 * Shade the note's blocks by who last changed them (Plan 33, A3), for the
 * `editorLineAuthors` setting. Mounted as a NoteEditor child: blames the
 * shown text against the backup history on open, after edits settle, and
 * every minute, and hands the authors to `line-authors-plugin`. A vault
 * without backup, or a failed blame, simply shows no shading.
 */
export function LineAuthorShading(props: LineAuthorShadingProps): ReactElement | null {
  return props.enabled && props.generation !== null ? (
    <Shading {...props} generation={props.generation} />
  ) : null
}

function Shading({
  path,
  generation,
  header,
}: LineAuthorShadingProps & { generation: number }): null {
  const editor = useEditor()
  useExtension(useMemo(() => definePlugin(createLineAuthorsPlugin()), []))

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let request = 0
    let dom: HTMLElement | null = null
    const headerLines = header.split('\n').length - 1

    const blame = (): void => {
      if (cancelled || !editor.mounted) {
        return
      }
      const view = editor.view
      const body = docToMarkdown(view.state.doc)
      const asked = ++request
      void gitBlame(path, header + body, generation)
        .then((result) => {
          if (cancelled || asked !== request) {
            return
          }
          const authors = lineAuthors(result, headerLines + body.split('\n').length)
          setLineAuthors(view, { body, authors: authors.slice(headerLines) })
        })
        .catch(() => {
          if (!cancelled && asked === request) {
            setLineAuthors(view, null)
          }
        })
    }
    const schedule = (): void => {
      if (timer !== null) {
        clearTimeout(timer)
      }
      timer = setTimeout(blame, REBLAME_AFTER_EDIT_MS)
    }
    // A plugin already in the view (path or header changed) blames now; a
    // fresh one says so with LINE_AUTHORS_READY once it is installed.
    const cancelMount = whenEditorMounted(editor, () => {
      dom = editor.view.dom
      dom.addEventListener(LINE_AUTHORS_READY, blame)
      dom.addEventListener(LINE_AUTHORS_DOC_CHANGED, schedule)
      blame()
    })
    const interval = setInterval(blame, REBLAME_EVERY_MS)
    return () => {
      cancelled = true
      cancelMount()
      clearInterval(interval)
      if (timer !== null) {
        clearTimeout(timer)
      }
      dom?.removeEventListener(LINE_AUTHORS_READY, blame)
      dom?.removeEventListener(LINE_AUTHORS_DOC_CHANGED, schedule)
      if (editor.mounted) {
        setLineAuthors(editor.view, null)
      }
    }
  }, [editor, path, generation, header])

  return null
}
