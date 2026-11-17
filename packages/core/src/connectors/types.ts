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
  /**
   * The values this item offers to the user's path pattern, by token name
   * (`title`, `category`, `date`...). See {@link Connector.patternFields}.
   * When the user's pattern renders to nothing, the engine names the file
   * with the connector's default pattern instead.
   */
  readonly fields: Readonly<Record<string, string>>
  /** The full markdown for a note that does not exist yet. */
  readonly source: string
  /**
   * Fold fresh source data into the note already on disk, returning the new
   * markdown — or `null` to leave the file untouched. Connectors must never
   * rewrite what the user may have edited; they only append what is new.
   */
  merge(existing: string): string | null
  /**
   * Whether a file without this connector's id, sitting at this note's
   * natural path, is the same item written by another app (another sync
   * tool pointed at the same folder). An adopted file is merged into like
   * one of ours, so a vault that already holds the item gets no duplicate.
   * Omitted: never.
   */
  adopts?(existing: string): boolean
  /**
   * The day this item belongs to and, when the source knows it, the local
   * time (`HH:MM`): where the daily-note link lands when the user turns
   * that on. Omitted: the day of the sync, no time.
   */
  readonly day?: { readonly date: string; readonly time: string | null }
  /** The display title the daily-note link carries. */
  readonly title: string
}

/** One on/off choice about what a connector writes (Granola's transcript …). */
export interface ConnectorOption {
  /** Key in {@link ConnectorFetchInput.options} and the persisted settings. */
  readonly key: string
  readonly label: string
  readonly description: string
}

/** What a connector receives for one fetch. */
export interface ConnectorFetchInput {
  /** The user's credential for the source (from the OS keychain). */
  readonly token: string
  /** Tags every new note carries, as the engine resolved them (the user's, else the default). */
  readonly tags: readonly string[]
  /** The user's {@link Connector.options} choices; a missing key is off. */
  readonly options: Readonly<Record<string, boolean>>
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
  /**
   * Default path pattern inside the folder, e.g. `{title}`. The user can
   * replace it: `/` makes subfolders, `{name}` inserts a field.
   */
  readonly defaultPattern: string
  /** Fields a pattern may use, in the order the settings hint lists them. */
  readonly patternFields: readonly string[]
  /** A typical item's fields, for the settings preview of where notes land. */
  readonly exampleFields: Readonly<Record<string, string>>
  /** Tags new notes carry unless the user chooses others. */
  readonly defaultTags: readonly string[]
  /** What the user may switch on or off about a note's content. */
  readonly options: readonly ConnectorOption[]
  /** Default heading for the daily-note links (`Meetings`). */
  readonly dailyHeading: string
  /** Where the user creates the credential this connector needs. */
  readonly tokenUrl: string
  /** Label for the credential field. */
  readonly tokenLabel: string
  /** The credential's name mid-sentence ("Get API key", "Add your access token"). */
  readonly tokenNoun: string
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
