import type { FetchFn } from '../sync/github-api'

/** Identifier of one built-in connector (see `CONNECTORS` in `./registry`). */
export type ConnectorId = 'readwise' | 'granola'

/**
 * One note a connector wants in the graph, keyed by its source identity.
 * The sync engine owns placement and dedupe; the connector owns content.
 */
export interface ConnectorNote {
  /**
   * The source's stable id for this item (a Readwise book id, a Granola note
   * id). Written to frontmatter under the connector's `idKey`, which is how a
   * later run — on this device or another — finds the note again.
   */
  readonly sourceId: string
  /** Filename stem (no folder, no `.md`), already filesystem-safe. */
  readonly fileStem: string
  /** The full markdown for a note that does not exist yet. */
  readonly source: string
  /**
   * Fold fresh source data into the note already on disk, returning the new
   * markdown — or `null` to leave the file untouched. Connectors must never
   * rewrite what the user may have edited; they only append what is new.
   */
  merge(existing: string): string | null
}

/** What a connector receives for one fetch. */
export interface ConnectorFetchInput {
  /** The user's credential for the source (from the OS keychain). */
  readonly token: string
  /** Only items changed after this instant are needed; `null` fetches everything. */
  readonly since: Date | null
  /** The HTTP transport (the Tauri HTTP plugin in the app, a fake in tests). */
  readonly fetchFn: FetchFn
  /** Abort gate, checked between requests. */
  readonly isStale: () => boolean
  /**
   * Whether the graph already holds a note for `sourceId`. A connector whose
   * notes are written once checks this before an expensive per-item request.
   */
  readonly hasNote: (sourceId: string) => Promise<boolean>
}

/**
 * A connector: a read-only source of notes. Adding a source means adding one
 * of these to the registry — the engine, settings, scheduling and UI are
 * shared.
 */
export interface Connector {
  readonly id: ConnectorId
  /** Display name. */
  readonly label: string
  /** One-line description of what lands in the graph. */
  readonly description: string
  /** Frontmatter key carrying {@link ConnectorNote.sourceId}. */
  readonly idKey: string
  /** Default graph-relative folder for new notes. */
  readonly defaultFolder: string
  /** Where the user creates the credential this connector needs. */
  readonly tokenUrl: string
  /** Label for the credential field. */
  readonly tokenLabel: string
  /**
   * How far a run looks back before the last successful sync, absorbing
   * items the source publishes late (a meeting whose summary finishes after
   * the previous run). Dedupe makes the overlap free.
   */
  readonly overlapMs: number
  /** Verify a credential without fetching data; throws on rejection. */
  verify(token: string, fetchFn: FetchFn): Promise<void>
  /** Yield the notes changed since `input.since`. */
  fetchNotes(input: ConnectorFetchInput): AsyncIterable<ConnectorNote>
}
