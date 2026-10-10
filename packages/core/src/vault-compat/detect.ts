import { isCompatKind, type CompatKindId } from './kinds'

/** One thing in a note Kore can't render, with what makes it specific. */
export interface CompatFinding {
  readonly kind: CompatKindId
  /** The diagram type for Mermaid (`gantt`, `pie`…); null for every other kind. */
  readonly detail: string | null
}

/**
 * Mermaid diagram headers the editor's renderer (beautiful-mermaid, through
 * Meowdown) draws. Anything else in a ```mermaid fence shows an error.
 * Lowercased, first word of the header line.
 */
const RENDERED_MERMAID_TYPES = new Set([
  'graph',
  'flowchart',
  'sequencediagram',
  'classdiagram',
  'statediagram',
  'statediagram-v2',
  'erdiagram',
  'xychart',
  'xychart-beta',
])

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/
/** Templater tags: `<% … %>`, `<%* … %>`, and the whitespace-control forms. */
const TEMPLATER_TAG = /<%[*+_-]?\s/
/** Dataview inline queries: `` `= this.status` `` and `` `$= dv.current()` ``. */
const DATAVIEW_INLINE = /`\$?=\s[^`]*`/
const WIKI_TARGET = /\[\[([^\]|#^]+)/g
const MARKDOWN_TARGET = /\]\(([^)\s]+)\)/g

interface OpenFence {
  readonly marker: string
  readonly language: string
  readonly body: string[]
}

/** The kind a link target names when it is a file Kore can't open. */
function linkTargetKind(target: string): string | null {
  let decoded = target.trim()
  try {
    decoded = decodeURI(decoded)
  } catch {
    // Keep the raw target: a stray `%` is still a name.
  }
  const lower = decoded.toLowerCase()
  if (lower.endsWith('.canvas')) {
    return 'canvas'
  }
  if (lower.endsWith('.excalidraw') || lower.endsWith('.excalidraw.md')) {
    return 'excalidraw'
  }
  return null
}

/** The first word of a Mermaid diagram's header, past `%%` comments and a `---` config block. */
function mermaidDiagramType(body: readonly string[]): string | null {
  let inConfig = false
  let seenContent = false
  for (const raw of body) {
    const line = raw.trim()
    if (line === '---' && (inConfig || !seenContent)) {
      inConfig = !inConfig
      seenContent = true
      continue
    }
    if (inConfig || line === '' || line.startsWith('%%')) {
      continue
    }
    return /^[\w-]+/.exec(line)?.[0].toLowerCase() ?? null
  }
  return null
}

function fenceKind(fence: OpenFence): { kind: string; detail: string | null } | null {
  const language = fence.language.toLowerCase()
  if (language === 'dataview' || language === 'dataviewjs') {
    return { kind: 'dataview', detail: null }
  }
  if (language.startsWith('ad-')) {
    return { kind: 'admonition', detail: null }
  }
  if (language === 'mermaid') {
    const type = mermaidDiagramType(fence.body)
    if (type !== null && !RENDERED_MERMAID_TYPES.has(type)) {
      return { kind: 'mermaid', detail: type }
    }
  }
  return null
}

/**
 * Everything in one note that Kore shows differently from Obsidian, from its
 * raw markdown: plugin code blocks (Dataview, Admonition), Mermaid diagram
 * types the renderer can't draw, Templater tags and inline Dataview outside
 * code, links to `.canvas` and Excalidraw files, and the note itself when it
 * is an Excalidraw drawing. Each kind and detail is reported once per note,
 * and only kinds still in {@link COMPAT_KINDS}.
 */
export function detectCompatFindings(path: string, source: string): CompatFinding[] {
  const found = new Map<string, CompatFinding>()
  const add = (kind: string, detail: string | null = null): void => {
    if (isCompatKind(kind)) {
      found.set(`${kind}\u{0}${detail ?? ''}`, { kind, detail })
    }
  }

  if (path.toLowerCase().endsWith('.excalidraw.md')) {
    add('excalidraw')
  }

  let fence: OpenFence | null = null
  const closeFence = (open: OpenFence): void => {
    const hit = fenceKind(open)
    if (hit !== null) {
      add(hit.kind, hit.detail)
    }
  }
  for (const line of source.split(/\r?\n/)) {
    if (fence !== null) {
      const close = FENCE_CLOSE.exec(line)
      if (
        close?.[1] !== undefined &&
        close[1][0] === fence.marker[0] &&
        close[1].length >= fence.marker.length
      ) {
        closeFence(fence)
        fence = null
      } else {
        fence.body.push(line)
      }
      continue
    }
    const open = FENCE_OPEN.exec(line)
    if (open?.[1] !== undefined) {
      fence = { marker: open[1], language: open[2] ?? '', body: [] }
      continue
    }
    if (TEMPLATER_TAG.test(line)) {
      add('templater')
    }
    if (DATAVIEW_INLINE.test(line)) {
      add('dataview')
    }
    for (const pattern of [WIKI_TARGET, MARKDOWN_TARGET]) {
      for (const match of line.matchAll(pattern)) {
        const kind = match[1] === undefined ? null : linkTargetKind(match[1])
        if (kind !== null) {
          add(kind)
        }
      }
    }
  }
  // An unclosed fence runs to the end of the note, as CommonMark reads it.
  if (fence !== null) {
    closeFence(fence)
  }
  return [...found.values()]
}
