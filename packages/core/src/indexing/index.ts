/**
 * `@reflect/core` indexing layer (Plan 04) — the TS pipeline that turns parsed
 * notes into the SQLite projection, plus the typed read getters over it.
 */
export {
  openIndex,
  applyIndexedNote,
  applyIndexedNotes,
  removeFromIndex,
  removeFromIndexBatch,
  moveNoteIndexed,
  clearIndex,
  setIndexMeta,
  watchStart,
  watchStop,
} from './commands'
export {
  FILE_CHANGES_EVENT,
  RECONCILE_EVENT,
  subscribeFileChanges,
  subscribeReconcileRequests,
  emitFileChanges,
  type FileChange,
} from './file-changes'
export { setLocalWriteEcho, subscribeOwnWrites } from './local-write-echo'
export { subscribeIcloudConflicts, subscribeIcloudWatchFailed } from './icloud-conflicts'
export { subscribeIndexApplied, type IndexAppliedListener } from './index-applied'
export { INDEX_WRITTEN_EVENT, subscribeIndexWritten } from './index-written'
export { NOTE_MOVED_EVENT, subscribeNoteMoved } from './note-moved'
export {
  subscribeIndexChanges,
  applyIndexChanges,
  type ApplyErrorHandler,
  type MovedHandler,
} from './live'
export { hashContent } from './hash'
export { availableTemplatePath, slugPathForTitle, templateSlugPathForTitle } from './note-paths'
export { listTemplates, type TemplateEntry } from './template-list'
export {
  buildIndexedNote,
  CLAIM_TIER,
  decodeTaskBreadcrumbs,
  encodeTaskBreadcrumbs,
  indexedNoteSchema,
  indexedLinkSchema,
  indexedTagSchema,
  indexedAliasSchema,
  PROJECTION_VERSION,
  PROJECTION_VERSION_KEY,
  type IndexedNote,
  type IndexedLink,
  type IndexedTag,
  type IndexedAlias,
} from './indexed-note'
export {
  indexNote,
  reindexNotesReferencing,
  rebuildIndex,
  reconcileIndex,
  syncIndex,
  type IndexPassOptions,
} from './indexer'
export {
  dailyDatesInRange,
  getBacklinks,
  getBacklinksWithContext,
  getConflictedNotes,
  getDuplicateNoteIds,
  getIndexMeta,
  getLinkSources,
  getPathLinkSources,
  getNote,
  getNotesByTag,
  getOpenTasks,
  getCompletedTasks,
  getPinnedNotes,
  getWikiAddressForPath,
  suggestWikiTargets,
  suggestWikiLinkTargets,
  suggestTags,
  getIndexedFileFacts,
  getIndexedFileFactsByPath,
  listDailyNotes,
  resolveWikiTarget,
  type Backlink,
  type BacklinkContext,
  type BacklinkContextPage,
  type BacklinkContextPageOptions,
  type BacklinkSourceCursor,
  type ConflictedNote,
  type DailyNoteRow,
  type DailyNotesRange,
  type DuplicateIdGroup,
  type NoteRow,
  type OpenTask,
  type PinnedNote,
  type TagSuggestion,
  type WikiLinkSuggestionResult,
} from './queries'
export { resolveNoteTarget } from './resolve-target'
export {
  findUnlinkedOccurrence,
  getUnlinkedMentions,
  MIN_MENTION_TITLE_LENGTH,
  type UnlinkedMention,
} from './unlinked-mentions'
export {
  groupTaskContexts,
  groupTasks,
  taskDateBucket,
  type TaskContext,
  type TaskGroup,
  type TaskGroupKind,
} from './group-tasks'
export { getGraphMap, type GraphMap, type GraphMapEdge, type GraphMapNode } from './graph-map'
export {
  loadGraphInsights,
  listPrivateNotePaths,
  type ActivityDay,
  type GraphInsights,
  type GraphInsightsOptions,
  type LinkedNoteRank,
} from './insights'
export {
  nextOccurrenceAppends,
  nextOccurrenceContent,
  nextOccurrenceDate,
  taskContentDueDate,
  taskContentRepeat,
  type TaskRepeat,
} from './task-repeat'
export {
  compareTaskPriority,
  cycleTaskContentPriority,
  stripTaskContentPriority,
  taskContentPriority,
  taskRawPriority,
  withTaskContentPriority,
  type TaskPriority,
} from './task-priority'
export {
  listNotes,
  listNoteTags,
  listRecentNotes,
  type NoteListEntry,
  type NoteListOptions,
  type NoteTagFacet,
  type RecentNoteRow,
  type RecentNotesOptions,
} from './note-list'
export {
  rankWikiSuggestions,
  mergeDateSuggestions,
  serializeWikiSuggestionAddress,
  type WikiLinkSuggestion,
  type WikiSuggestion,
  type GeneratedDate,
} from './suggest'
export {
  generateDateSuggestions,
  type DateSuggestion,
  type DateSuggestionContext,
} from './date-suggestions'
export {
  parseHighlights,
  randomNotePath,
  HIGHLIGHT_START,
  HIGHLIGHT_END,
  type HighlightSegment,
} from './search'
export { lineAt, lineSnippet, previewSnippet } from './snippet'
export {
  blockContextAt,
  blockContextLinesAt,
  prepareBlockContext,
  type BlockContextLines,
  type BlockContextSource,
} from './block-context'
export { extractSnippetTasks, type SnippetTask } from './snippet-tasks'
export {
  getTagType,
  listTagTypes,
  listCollection,
  TITLE_SORT_KEY,
  UPDATED_SORT_KEY,
  listNoteTagTypes,
  getNoteProperties,
  listNotesWithProperty,
  propertyRowValue,
  type TagTypeEntry,
  type CollectionEntry,
  type CollectionSort,
  type ListCollectionOptions,
  type CollectionValue,
} from './collections'
export { attachRollups, type RollupLookup } from './rollups'
export { parseSearchQuery, type ParsedSearchQuery, type SearchFilters } from './filter-query'
export {
  searchNotes,
  searchWithFilters,
  type FilteredSearchHit,
  type FilteredSearchOptions,
  type SearchHit,
} from './filtered-search'
export {
  rewriteLinksForTitleChange,
  rewritePathLinksForMove,
  nextAliases,
  type RenameBacklink,
  type RenameIo,
  type TitleRenameRewriteOptions,
  type TitleRenameRewriteResult,
} from './rename'
