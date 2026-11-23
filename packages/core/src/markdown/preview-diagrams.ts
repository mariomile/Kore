/**
 * Read-only previews (the palette, the Details peek, hover cards) draw
 * ` ```mermaid ` fences with a small renderer that knows only these diagram
 * types. The editor draws every type; a preview given one it cannot draw
 * printed the renderer's error in red in the middle of the note.
 */
const PREVIEW_DIAGRAM =
  /^(?:graph|flowchart|stateDiagram(?:-v2)?|sequenceDiagram|classDiagram|erDiagram|xychart(?:-beta)?)\b/

/** A whole `mermaid` fence: indent, the fence marks, the body. */
const MERMAID_FENCE = /^([ \t]*)(`{3,}|~{3,})mermaid[ \t]*\n([\s\S]*?)\n\1\2[ \t]*$/gm

/**
 * The line naming the diagram type: the first that is not blank or a `%%`
 * comment. This is the preview renderer's own rule, on purpose: it cannot draw
 * a diagram that opens with YAML frontmatter or a multi-line `%%{init}%%`
 * either, so those are shown as code too.
 */
function diagramHeader(body: string): string {
  for (const line of body.split('\n')) {
    const text = line.trim()
    if (text !== '' && !text.startsWith('%%')) {
      return text
    }
  }
  return ''
}

/**
 * `markdown` for a read-only preview: a Mermaid fence the preview cannot draw
 * (gantt, pie, mindmap…) becomes a plain code fence, so the reader sees the
 * diagram's source, as for any other code, instead of an error. The note on
 * disk is never touched, and the editor still draws the diagram.
 */
export function withUndrawnDiagramsAsCode(markdown: string): string {
  if (!markdown.includes('mermaid')) {
    return markdown
  }
  return markdown.replaceAll(MERMAID_FENCE, (fence, indent: string, marks: string, body: string) =>
    PREVIEW_DIAGRAM.test(diagramHeader(body))
      ? fence
      : `${indent}${marks}\n${body}\n${indent}${marks}`,
  )
}
