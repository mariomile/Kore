/**
 * `@reflect/core` markdown document model (Plan 03) — the one canonical
 * parse/extract/edit layer over `@meowdown/markdown` + `yaml`, shared by the
 * indexer (Plan 04), editor (Plan 05), backlinks (Plan 07), and CLI (Plan 14).
 */
export {
  frontmatterSchema,
  gistFrontmatterSchema,
  isPinned,
  pinnedOrder,
  PARSED_NOTE_VERSION,
  type Frontmatter,
  type GistFrontmatter,
  type Span,
  type WikiLink,
  type MarkdownLink,
  type Heading,
  type AssetRef,
  type TaskMarker,
  type ParsedNote,
} from './model'
export {
  splitFrontmatter,
  parseFrontmatter,
  upsertFrontmatter,
  type FrontmatterSplit,
  type ParsedFrontmatter,
} from './frontmatter'
export { parseBody } from './grammar'
export {
  CALLOUT_KINDS,
  formatCalloutBlock,
  parseCalloutMarker,
  type CalloutKind,
  type CalloutMarker,
} from './callout'
export {
  formatEmbedBlock,
  parseEmbedBlocks,
  type EmbedBlock,
  type HtmlEmbed,
  type UrlEmbed,
} from './embed-block'
export {
  linkKind,
  linkKindInfo,
  LINK_KIND_FALLBACK,
  LINK_KINDS,
  videoPlayerUrl,
  type LinkKind,
  type LinkKindInfo,
} from './link-kind'
export {
  extractHeadingSection,
  formatNoteTransclusion,
  parseNoteTransclusions,
  transclusionMarkdown,
  wikiEmbedKind,
  type NoteTransclusion,
  type WikiEmbedKind,
} from './note-transclusion'
export {
  parseNoteAppearance,
  parseNoteAppearanceFromSource,
  parseNoteCover,
  parseNoteIcon,
  type NoteAppearance,
  type NoteIcon,
} from './note-appearance'
export { parseNote, isTagName, hasAuthoredTitle } from './extract'
export { appendBodyTag, bodyHasTag } from './body-tag'
export {
  applyReplaceMatches,
  findReplaceMatches,
  type ReplaceMatch,
  type ReplaceScanOptions,
} from './replace-scan'
export {
  scanInlineWikiLinks,
  scanInlineImages,
  scanInlineSegments,
  type InlineWikiLink,
  type InlineImage,
  type InlineSegment,
} from './scan'
export {
  appendBlock,
  appendListItem,
  type ListItemKind,
  appendTaskLine,
  appendTaskToContext,
  wikiLinkSafe,
  editTaskLine,
  removeTaskLine,
  setTaskDueDate,
  clearTaskDueDate,
  setTaskDueTime,
  taskLineToBullet,
  toggleTaskMarker,
  TaskStaleError,
} from './edit'
export { retitleWikiLinks, type WikiLinkRetitleOptions } from './retitle'
export { displayNoteTitle, stripLeadingHeading, wikiLinkTargetForTitle } from './note-title'
export { parseTaskMarker } from './task-marker'
export {
  conflictMarkerBlockCount,
  conflictMarkerLabels,
  detectConflictMarkers,
  parseConflictMarkers,
  resolveConflictMarkers,
  type ConflictMarkerLabels,
  type ConflictResolution,
  type ConflictSegment,
  type ConflictSide,
} from './conflict-markers'
export { canonicalEmail, canonicalEmails, extractEmailFields, foldEmail } from './email-fields'
export { foldFallbackTitleKey, foldKey, foldTag } from './keys'
export { gistBodyHash, gistFilename } from './gist'
export { slugForTitle } from './slug'
export { subjectAliases } from './subject-aliases'
export {
  normalizeWikiTarget,
  resolved,
  resolveWikiLink,
  resolveWikiLinkAsync,
  unresolved,
  type NormalizedTarget,
  type Resolution,
  type WikiLookup,
  type AsyncWikiLookup,
} from './resolve'
export { expandTemplatePlaceholders, type TemplatePlaceholderValues } from './template-placeholders'
