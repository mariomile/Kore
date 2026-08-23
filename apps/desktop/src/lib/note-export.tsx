import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { MarkdownView } from '@meowdown/react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { parseNote, splitFrontmatter } from '@reflect/core'
import { isSafeAssetSource } from '@/editor/use-asset-persistence'
import { exportFileName, runFileExport } from '@/lib/export-file'
import { readNoteSource } from '@/lib/note-frontmatter'

/**
 * Styled note export: one self-contained HTML file that looks like the note
 * does in the app. The body is rendered by the same meowdown `MarkdownView`
 * the in-app previews use (wiki-link chips, round task checkboxes, images),
 * the app's live stylesheets ride along inline, vault images are embedded as
 * data URIs, and a print stylesheet plus a floating button make the browser's
 * print dialog the PDF path. Nothing leaves the machine — the file goes where
 * the OS save dialog pointed.
 */

/** Escape text for an HTML text node or double-quoted attribute value. */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * Whether the body already opens with its own `# Title` heading. Daily notes
 * and frontmatter-titled notes don't, so the export adds one for them.
 */
export function needsTitleHeading(body: string): boolean {
  const firstLine = body.split('\n').find((line) => line.trim() !== '')
  return !(firstLine !== undefined && /^#\s/.test(firstLine.trimStart()))
}

/**
 * Every CSS rule the app currently has loaded, inlined. The exported DOM
 * carries the app's own class names, so shipping the app's stylesheets is
 * what keeps the file pixel-faithful; a cross-origin sheet (none in
 * production) is skipped rather than crashing the export. The bundled
 * InterVariable `@font-face` URL won't resolve from a saved file — the
 * font stack's fallbacks take over silently.
 */
function collectAppCss(): string {
  const chunks: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      chunks.push(Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n'))
    } catch {
      // Cross-origin stylesheet — nothing of ours lives there.
    }
  }
  return chunks.join('\n')
}

/** Page chrome for the exported file: reading column, print behavior. */
const EXPORT_CSS = `
body {
  margin: 0;
  background: var(--surface-app, #f7f7f8);
  color: var(--text, #17181c);
  -webkit-font-smoothing: antialiased;
}
.lore-export-page {
  box-sizing: border-box;
  max-width: 46rem;
  min-height: 100vh;
  margin: 0 auto;
  padding: 3.5rem 2rem 6rem;
  background: var(--surface, #ffffff);
}
.lore-export-title {
  margin: 0 0 1.5rem;
}
.lore-export-print {
  position: fixed;
  right: 1.25rem;
  bottom: 1.25rem;
  padding: 0.5rem 0.9rem;
  border: none;
  border-radius: var(--radius, 0.5rem);
  background: var(--accent, #4f46e5);
  color: var(--text-on-brand, #ffffff);
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  box-shadow: var(--shadow-md, 0 8px 24px rgba(18, 19, 23, 0.15));
}
@media print {
  body {
    background: #ffffff;
  }
  .lore-export-page {
    max-width: none;
    min-height: 0;
    padding: 0;
    background: #ffffff;
  }
  .lore-export-print {
    display: none;
  }
}
`

export interface ExportDocumentInput {
  /** The note's display title (the `<title>` and the added heading). */
  title: string
  /** The serialized, image-inlined markdown rendering. */
  bodyHtml: string
  /** The app CSS captured at export time. */
  css: string
  /** Add an `<h1>` because the body doesn't open with its own. */
  addTitleHeading: boolean
  /** Attributes copied off the app's `<html>` so themes and accents apply. */
  rootAttributes: Record<string, string>
}

/**
 * Assemble the final standalone document. Pure — everything environmental
 * (DOM serialization, CSS capture, theme attributes) is gathered by the
 * caller, so this seam is directly testable.
 */
export function buildExportDocument(input: ExportDocumentInput): string {
  const attrs = Object.entries(input.rootAttributes)
    .filter(([, value]) => value !== '')
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join('')
  const heading = input.addTitleHeading
    ? `<h1 class="lore-export-title">${escapeHtml(input.title)}</h1>\n`
    : ''
  return `<!doctype html>
<html${attrs}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(input.title)}</title>
<style>
${input.css}
</style>
<style>
${EXPORT_CSS}
</style>
</head>
<body>
<main class="lore-export-page">
${heading}${input.bodyHtml}
</main>
<button type="button" class="lore-export-print" onclick="window.print()">Print / Save as PDF</button>
</body>
</html>
`
}

/** Read a Blob back as a `data:` URI. */
async function blobToDataUri(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('could not read image data'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Replace every vault-asset image with an embedded `data:` URI, so the file
 * stands alone. Remote (`https:`) images keep their URLs — the browser loads
 * them like any web page — and an asset that fails to fetch keeps its src
 * rather than failing the export.
 */
async function inlineAssetImages(host: HTMLElement): Promise<void> {
  const images = Array.from(host.querySelectorAll('img'))
  await Promise.all(
    images.map(async (image) => {
      const src = image.getAttribute('src') ?? ''
      if (src === '' || /^(?:https?|data):/.test(src)) {
        return
      }
      try {
        const response = await fetch(src)
        if (!response.ok) {
          return
        }
        image.setAttribute('src', await blobToDataUri(await response.blob()))
      } catch {
        // Unresolvable asset — leave the reference; the export still opens.
      }
    }),
  )
}

/**
 * Render the note body exactly as the app's previews do and serialize the
 * result. Mounts `MarkdownView` directly (not `MarkdownPreview`) in an
 * off-screen host: the preview wrapper's link handler needs router context
 * that a headless mount doesn't have, and an export wants plain `<a href>`
 * anchors anyway.
 */
export async function renderNoteBodyHtml(body: string, generation: number): Promise<string> {
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-100000px'
  host.style.top = '0'
  host.style.width = '720px'
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    flushSync(() => {
      root.render(
        createElement(MarkdownView, {
          markdown: body,
          markMode: 'hide',
          interactive: true,
          resolveImageUrl: (src: string) => {
            if (/^https?:\/\//.test(src)) {
              return src
            }
            return isSafeAssetSource(src)
              ? convertFileSrc(`${generation}/${src}`, 'reflect-asset')
              : undefined
          },
          className: 'reflect-editor',
        }),
      )
    })
    // Two frames: one for meowdown's own post-commit DOM work, one for
    // layout, so the serialized tree is the settled one.
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await inlineAssetImages(host)
    return host.innerHTML
  } finally {
    root.unmount()
    host.remove()
  }
}

/**
 * The full export flow behind the `note.export` command and the sidebar
 * action: read the live note source, ask where to save (through the shared
 * {@link runFileExport} dialog/operation scaffolding), render + assemble,
 * write.
 */
export async function runNoteExport(path: string, generation: number): Promise<void> {
  let source = ''
  await runFileExport({
    operation: 'Exporting note',
    defaultPath: async () => {
      source = await readNoteSource(path)
      return exportFileName(parseNote({ path, source }).title, 'note', 'html')
    },
    filter: { name: 'HTML', extensions: ['html'] },
    build: async () => {
      const parsed = parseNote({ path, source })
      const body = splitFrontmatter(source).body
      return buildExportDocument({
        title: parsed.title,
        bodyHtml: await renderNoteBodyHtml(body, generation),
        css: collectAppCss(),
        addTitleHeading: needsTitleHeading(body),
        rootAttributes: {
          class: document.documentElement.getAttribute('class') ?? '',
          'data-theme': document.documentElement.getAttribute('data-theme') ?? '',
          'data-accent': document.documentElement.getAttribute('data-accent') ?? '',
          style: document.documentElement.getAttribute('style') ?? '',
        },
      })
    },
  })
}
