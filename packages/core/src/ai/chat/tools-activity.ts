import type { TypedToolCall, TypedToolResult } from 'ai'
import type { CloudNoteListing, CloudSearchHit } from '../checkers'
import type { NoteTools } from './tools'
import type { SetNotePropertyValue } from './tools-io'

/**
 * The tool-activity side of the note tools: the {@link NoteToolCall} and
 * {@link NoteToolResult} unions the engine streams and the UI renders, and
 * the mappers from SDK stream parts onto them.
 */

/** The hit slice tool-activity UI renders (full hits stay engine-side). */
export type NoteHitSummary = Pick<CloudSearchHit, 'path' | 'title'>

/** One note's outcome in a read_notes call, for the tool-activity UI. */
export interface ReadNoteSummary {
  path: string
  title: string | null
  /** The per-note refusal/miss text, or `null` when the read succeeded. */
  error: string | null
}

/** One asset's outcome in a read_assets call, for the tool-activity UI. */
export interface ReadAssetSummary {
  path: string
  /** The per-asset refusal/miss text, or `null` when the read succeeded. */
  error: string | null
}

/** One tool invocation, as the transcript sees it. */
export type NoteToolCall =
  | { tool: 'search'; toolCallId: string; query: string }
  | { tool: 'read'; toolCallId: string; paths: string[] }
  | { tool: 'assets'; toolCallId: string; paths: string[] }
  | { tool: 'recents'; toolCallId: string; tag: string | null }
  | { tool: 'dailies'; toolCallId: string; start: string; end: string }
  | { tool: 'collection'; toolCallId: string; tag: string }
  | { tool: 'setProperty'; toolCallId: string; path: string; key: string }
  | { tool: 'browse'; toolCallId: string; url: string }
  | { tool: 'readPage'; toolCallId: string }

/** One settled tool invocation. A failed read or listing keeps its refusal. */
export type NoteToolResult =
  | { tool: 'search'; toolCallId: string; query: string; hits: NoteHitSummary[] }
  | { tool: 'read'; toolCallId: string; notes: ReadNoteSummary[] }
  | { tool: 'assets'; toolCallId: string; assets: ReadAssetSummary[] }
  | {
      tool: 'recents'
      toolCallId: string
      tag: string | null
      notes: NoteHitSummary[]
      error: string | null
    }
  | { tool: 'dailies'; toolCallId: string; start: string; end: string; days: NoteHitSummary[] }
  | {
      tool: 'collection'
      toolCallId: string
      tag: string
      notes: NoteHitSummary[]
      error: string | null
    }
  | {
      tool: 'setProperty'
      toolCallId: string
      path: string
      key: string
      error: string | null
      value: SetNotePropertyValue | null
    }
  | {
      tool: 'browse'
      toolCallId: string
      /** The final URL — the page's own after redirects, the requested one on failure. */
      url: string
      title: string | null
      error: string | null
    }
  | {
      tool: 'readPage'
      toolCallId: string
      url: string | null
      title: string | null
      error: string | null
    }

/** Map an SDK tool-call part onto {@link NoteToolCall} (null for dynamic). */
export function noteToolCall(part: TypedToolCall<NoteTools>): NoteToolCall | null {
  if (part.dynamic) {
    return null
  }
  switch (part.toolName) {
    case 'search_notes':
      return { tool: 'search', toolCallId: part.toolCallId, query: part.input.query }
    case 'read_notes':
      return { tool: 'read', toolCallId: part.toolCallId, paths: part.input.paths }
    case 'read_assets':
      return { tool: 'assets', toolCallId: part.toolCallId, paths: part.input.paths }
    case 'list_recent_notes':
      return { tool: 'recents', toolCallId: part.toolCallId, tag: part.input.tag ?? null }
    case 'list_daily_notes':
      return {
        tool: 'dailies',
        toolCallId: part.toolCallId,
        start: part.input.start,
        end: part.input.end,
      }
    case 'list_collection':
      return { tool: 'collection', toolCallId: part.toolCallId, tag: part.input.tag }
    case 'set_note_property':
      return {
        tool: 'setProperty',
        toolCallId: part.toolCallId,
        path: part.input.path,
        key: part.input.key,
      }
    case 'open_web_page':
      return { tool: 'browse', toolCallId: part.toolCallId, url: part.input.url }
    case 'read_web_page':
      return { tool: 'readPage', toolCallId: part.toolCallId }
  }
}

/** The path+title slice of one listing, for the tool-activity UI. */
function listingSummary(entry: CloudNoteListing): NoteHitSummary {
  return { path: entry.path, title: entry.title }
}

/** Map an SDK tool-result part onto {@link NoteToolResult} (null for dynamic). */
export function noteToolResult(part: TypedToolResult<NoteTools>): NoteToolResult | null {
  if (part.dynamic) {
    return null
  }
  switch (part.toolName) {
    case 'search_notes':
      return {
        tool: 'search',
        toolCallId: part.toolCallId,
        query: part.input.query,
        hits: part.output.hits.map((hit) => ({ path: hit.path, title: hit.title })),
      }
    case 'read_notes':
      return {
        tool: 'read',
        toolCallId: part.toolCallId,
        notes: part.output.notes.map((entry) =>
          entry.ok
            ? { path: entry.note.path, title: entry.note.title, error: null }
            : { path: entry.path, title: null, error: entry.error },
        ),
      }
    case 'read_assets':
      return {
        tool: 'assets',
        toolCallId: part.toolCallId,
        assets: part.output.assets.map((entry) =>
          entry.ok
            ? { path: entry.asset.path, error: null }
            : { path: entry.path, error: entry.error },
        ),
      }
    case 'list_recent_notes': {
      const output = part.output
      return output.ok
        ? {
            tool: 'recents',
            toolCallId: part.toolCallId,
            tag: part.input.tag ?? null,
            notes: output.notes.map(listingSummary),
            error: null,
          }
        : {
            tool: 'recents',
            toolCallId: part.toolCallId,
            tag: output.tag,
            notes: [],
            error: output.error,
          }
    }
    case 'list_daily_notes':
      return {
        tool: 'dailies',
        toolCallId: part.toolCallId,
        start: part.input.start,
        end: part.input.end,
        days: part.output.days.map(listingSummary),
      }
    case 'list_collection': {
      const output = part.output
      return output.ok
        ? {
            tool: 'collection',
            toolCallId: part.toolCallId,
            tag: output.tag,
            notes: output.rows.map((row) => ({ path: row.path, title: row.title })),
            error: null,
          }
        : {
            tool: 'collection',
            toolCallId: part.toolCallId,
            tag: output.tag,
            notes: [],
            error: output.error,
          }
    }
    case 'set_note_property': {
      const output = part.output
      return {
        tool: 'setProperty',
        toolCallId: part.toolCallId,
        path: output.path,
        key: part.input.key,
        error: output.ok ? null : output.error,
        value: output.ok ? output.value : null,
      }
    }
    case 'open_web_page': {
      const output = part.output
      return output.ok
        ? {
            tool: 'browse',
            toolCallId: part.toolCallId,
            url: output.page.url,
            title: output.page.title === '' ? null : output.page.title,
            error: null,
          }
        : {
            tool: 'browse',
            toolCallId: part.toolCallId,
            url: part.input.url,
            title: null,
            error: output.error,
          }
    }
    case 'read_web_page': {
      const output = part.output
      return output.ok
        ? {
            tool: 'readPage',
            toolCallId: part.toolCallId,
            url: output.page.url,
            title: output.page.title === '' ? null : output.page.title,
            error: null,
          }
        : {
            tool: 'readPage',
            toolCallId: part.toolCallId,
            url: null,
            title: null,
            error: output.error,
          }
    }
  }
}
