import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
} from 'react'
import { useEditor } from '@meowdown/react'
import { TextSelection } from '@prosekit/pm/state'
import type { Mounted, MountOptions } from 'pele/lazy'

type Pele = typeof import('pele/lazy')

let pelePromise: Promise<Pele> | null = null

/**
 * Pele's API, loaded on first use. Only the small lazy entry point comes in
 * here; each diagram type's parser and layout is its own chunk, fetched the
 * first time a diagram of that type is drawn. A note without a diagram never
 * loads any of it.
 */
function loadPele(): Promise<Pele> {
  pelePromise ??= import('pele/lazy').catch((error: unknown) => {
    pelePromise = null
    throw error
  })
  return pelePromise
}

/**
 * Diagrams are drawn from the note's own text. Links and remote images stay
 * off: a link in the SVG would navigate the app's webview, and a remote image
 * would fetch from the network when a note opens.
 */
const MOUNT_OPTIONS: MountOptions = {
  links: false,
  images: false,
  zoom: false,
}

/** Start drawing a little before the block scrolls into view. */
const VISIBILITY_MARGIN = '400px 0px'

/** True once the element has come near the viewport; it never goes back to false. */
function useHasBeenVisible(ref: { readonly current: HTMLElement | null }): boolean {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (visible || element === null) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: VISIBILITY_MARGIN },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, visible])
  return visible
}

interface MermaidDiagramProps {
  /** The fence body: Mermaid source. */
  code: string
}

/**
 * A ` ```mermaid ` fence drawn with Pele (MIT, from Obsidian): every diagram
 * type built into Mermaid 12, charts included, at a fraction of Mermaid's
 * weight. Rendered through Meowdown's `renderCodeBlock`, so the fence stays
 * plain Markdown on disk; Meowdown shows the source above the drawing while
 * the caret is inside the block, and a click on the drawing puts it there.
 */
export function MermaidDiagram({ code: liveCode }: MermaidDiagramProps): ReactElement {
  // Typing in the source redraws at the pace React can afford, never per key.
  const code = useDeferredValue(liveCode)
  const editor = useEditor()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const mountedRef = useRef<Mounted | null>(null)
  const visible = useHasBeenVisible(hostRef)

  const empty = code.trim() === ''

  useEffect(() => {
    const host = canvasRef.current
    if (!visible || host === null || empty) {
      return
    }
    let cancelled = false
    void loadPele()
      .then(async (pele) => {
        let type = null
        try {
          type = pele.detectType(code)
        } catch {
          // An undetectable header still mounts, and Pele shows its error.
        }
        await pele.load(type)
        if (cancelled) {
          return
        }
        if (mountedRef.current === null) {
          mountedRef.current = pele.mount(host, code, MOUNT_OPTIONS)
        } else if (mountedRef.current.source !== code) {
          mountedRef.current.update(code, MOUNT_OPTIONS)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          host.textContent = error instanceof Error ? error.message : String(error)
        }
      })
    return () => {
      cancelled = true
    }
  }, [visible, code, empty])

  useEffect(
    () => () => {
      mountedRef.current?.destroy()
      mountedRef.current = null
    },
    [],
  )

  // Put the caret at the start of the fence's source, as Meowdown's own
  // preview does, so the diagram is edited where it is drawn.
  const editSource = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const pre = event.currentTarget.closest('[data-meowdown-code-block-custom]')?.parentElement
        ?.firstElementChild
      if (!(pre instanceof HTMLElement) || pre.localName !== 'pre' || !editor.mounted) {
        return
      }
      event.preventDefault()
      const { view } = editor
      let position: number
      try {
        position = view.posAtDOM(pre, 0)
      } catch {
        return
      }
      const selection = TextSelection.near(view.state.doc.resolve(position), 1)
      view.dispatch(view.state.tr.setSelection(selection))
      view.focus()
    },
    [editor],
  )

  return (
    <div
      ref={hostRef}
      className="kore-diagram"
      data-kore-diagram=""
      data-testid="mermaid-diagram"
      onMouseDown={editSource}
    >
      {/* Pele owns this node's children; React never renders into it. */}
      <div ref={canvasRef} hidden={empty} />
      {empty ? <span data-empty="">Empty Mermaid diagram</span> : null}
    </div>
  )
}
