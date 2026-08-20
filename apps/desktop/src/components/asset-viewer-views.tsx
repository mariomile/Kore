import { useEffect, useState, type ReactElement } from 'react'
import { errorMessage } from '@reflect/core'
import { parseCsv } from '@/lib/csv'

/**
 * The attachment viewer's non-iframe bodies: CSV as a real table, DOCX
 * converted to sandboxed HTML, plain text as a scrolling pre. Each fetches
 * its bytes off the graph's `reflect-asset://` protocol and renders locally
 * — nothing leaves the device, and converted DOCX markup goes into a fully
 * sandboxed iframe exactly like HTML attachments do.
 */

/** Keep giant files from freezing the dialog; the tail is honestly reported. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_CSV_ROWS = 1000

interface Loaded<T> {
  state: 'loading' | 'error' | 'ready'
  value?: T
  error?: string
}

function useAssetData<T>(url: string, load: (response: Response) => Promise<T>): Loaded<T> {
  // Keyed by url with a render-time reset (not an effect setState): a new
  // asset shows "loading" on the very next paint, no cascading render.
  const [result, setResult] = useState<{ url: string; data: Loaded<T> }>({
    url,
    data: { state: 'loading' },
  })
  if (result.url !== url) {
    setResult({ url, data: { state: 'loading' } })
  }
  useEffect(() => {
    const controller = new AbortController()
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`could not read the file (${response.status})`)
        }
        return await load(response)
      })
      .then((value) => {
        setResult({ url, data: { state: 'ready', value } })
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setResult({ url, data: { state: 'error', error: errorMessage(cause) } })
        }
      })
    return () => {
      controller.abort()
    }
    // `load` is intentionally not a dependency: callers pass inline lambdas,
    // and the fetch must re-run only when the asset itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])
  return result.url === url ? result.data : { state: 'loading' }
}

function ViewerNotice({ children }: { children: string }): ReactElement {
  return (
    <p className="flex flex-1 items-center justify-center px-6 text-center text-sm text-text-muted">
      {children}
    </p>
  )
}

/** CSV/TSV as a table: first record as the header, capped for huge files. */
export function CsvAssetView({ url }: { url: string }): ReactElement {
  const data = useAssetData(url, async (response) => parseCsv(await response.text()))
  if (data.state === 'loading') {
    return <ViewerNotice>Loading…</ViewerNotice>
  }
  if (data.state === 'error' || data.value === undefined || data.value.length === 0) {
    return <ViewerNotice>{data.error ?? 'This file has no rows.'}</ViewerNotice>
  }
  const [header, ...rows] = data.value
  const visible = rows.slice(0, MAX_CSV_ROWS)
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-surface-sunken">
          <tr>
            {header?.map((cell, index) => (
              <th
                key={index}
                className="border-b border-border px-3 py-1.5 text-left font-semibold text-text"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-surface even:bg-surface-sunken/40">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border-b border-border/60 px-3 py-1 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX_CSV_ROWS ? (
        <p className="px-3 py-2 text-xs text-text-muted">
          Showing the first {MAX_CSV_ROWS} of {rows.length} rows — open externally for the rest.
        </p>
      ) : null}
    </div>
  )
}

/** The stylesheet injected around converted DOCX markup — the app's prose look. */
const DOCX_STYLE = `
  body { margin: 0; padding: 24px 28px; font-family: system-ui, sans-serif;
         font-size: 15px; line-height: 1.7; color: #26272c; }
  h1, h2, h3 { line-height: 1.3; letter-spacing: -0.01em; }
  table { border-collapse: collapse; } td, th { border: 1px solid #d5d6da; padding: 4px 8px; }
  img { max-width: 100%; }
`

/**
 * DOCX rendered via mammoth (loaded lazily — the converter never rides the
 * main bundle) into a sandboxed iframe: scripts, same-origin access, forms
 * and popups all blocked, same policy as HTML attachments.
 */
export function DocxAssetView({ url }: { url: string }): ReactElement {
  const data = useAssetData(url, async (response) => {
    const [mammoth, buffer] = await Promise.all([import('mammoth'), response.arrayBuffer()])
    const converted = await mammoth.convertToHtml({ arrayBuffer: buffer })
    return converted.value
  })
  if (data.state === 'loading') {
    return <ViewerNotice>Converting…</ViewerNotice>
  }
  if (data.state === 'error' || data.value === undefined) {
    return <ViewerNotice>{data.error ?? 'This document can’t be converted.'}</ViewerNotice>
  }
  return (
    <iframe
      title="Document"
      sandbox=""
      srcDoc={`<!doctype html><meta charset="utf-8"><style>${DOCX_STYLE}</style>${data.value}`}
      className="min-h-0 w-full flex-1 rounded-lg border border-border bg-white"
    />
  )
}

/** Plain text (txt/md/log/json), monospace, size-capped. */
export function TextAssetView({ url }: { url: string }): ReactElement {
  const data = useAssetData(url, async (response) => {
    const text = await response.text()
    return {
      text: text.slice(0, MAX_TEXT_BYTES),
      truncated: text.length > MAX_TEXT_BYTES,
    }
  })
  if (data.state === 'loading') {
    return <ViewerNotice>Loading…</ViewerNotice>
  }
  if (data.state === 'error' || data.value === undefined) {
    return <ViewerNotice>{data.error ?? 'This file can’t be displayed.'}</ViewerNotice>
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-surface">
      <pre className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-5 text-text">
        {data.value.text}
        {data.value.truncated ? '\n… (truncated — open externally for the rest)' : ''}
      </pre>
    </div>
  )
}
