/**
 * `@kore/core` markdown document model (Plan 03) — the one canonical
 * parse/extract/edit layer over `@meowdown/markdown` + `yaml`, shared by the
 * indexer (Plan 04), editor (Plan 05), backlinks (Plan 07), and CLI (Plan 14).
 */
export {
  frontmatterSchema,
  gistFrontmatterSchema,
  isPinned,
  isSensitivityPrivate,
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
  CALLOUT_ALIASES,
  CALLOUT_KINDS,
  calloutLabel,
  formatCalloutBlock,
  parseCalloutMarker,
  requoteCalloutBlock,
  separateCalloutTitles,
  type CalloutFold,
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
  type LinkKind,
  type LinkKindInfo,
} from './link-kind'
export { embedPlayer, startSeconds, type EmbedPlayer } from './embed-player'
export {
  blockIdsIn,
  blockLinkLabel,
  extractBlockSection,
  isBlockId,
  hiddenBlockIdTail,
  type HiddenBlockIdTail,
  lineBlockId,
  newBlockId,
  noteLinkBlockId,
  withoutBlockIds,
} from './block-ids'
export {
  planBranchMove,
  retargetBlockLinks,
  type BranchMove,
  type BranchMoveInput,
  type SourceBacklink,
} from './move-branch'
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
  noteIconValue,
  parseNoteAppearanceFromSource,
  parseNoteCover,
  parseNoteCoverY,
  DEFAULT_COVER_Y,
  parseNoteIcon,
  symbolIconValue,
  type NoteAppearance,
  type NoteIcon,
} from './note-appearance'
export {
  parseNote,
  isTagName,
  inlineTagNames,
  hasAuthoredTitle,
  frontmatterTagNames,
} from './extract'
export { appendBodyTag, bodyHasTag, removeBodyTag } from './body-tag'
export { addFrontmatterTag, addNoteTag, noteHasTag, removeNoteTag } from './note-tag'
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
export { cutTaskBlock, pasteTaskBlock, taskSectionNames, type TaskBlock } from './task-move'
export { retitleWikiLinks, type WikiLinkRetitleOptions } from './retitle'
export {
  displayNoteTitle,
  stripLeadingHeading,
  stripLeadingTagLine,
  wikiLinkTargetForTitle,
} from './note-title'
export { inlineEmbedSnapshots } from './embed-snapshot'
export { convertTaggedLineToNote, type TaggedLineConversion } from './tagged-line-conversion'
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
export { isBlankListSkeleton } from './blank-body'
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
export { mergeTemplateFrontmatter } from './template-frontmatter'
