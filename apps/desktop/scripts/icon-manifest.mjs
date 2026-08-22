/**
 * The app's icon set: component name → Solar (`@iconify-json/solar`) icon id.
 *
 * Solar's `-linear` family is the whole vocabulary — a single 24px grid, a
 * 1.5px hairline stroke, and consistently rounded terminals. Mixing families
 * (`-bold`, `-outline`, `-broken`) is what makes an icon set look assembled
 * rather than drawn, so every entry here ends in `-linear`. Glyphs Solar has
 * no linear equivalent for are hand-drawn to the same grid in
 * `src/components/icons/custom-icons.tsx` instead of borrowing another family.
 *
 * Consumed by `scripts/generate-icons.mjs`, which writes
 * `src/components/icons/solar-icons.gen.tsx`.
 */
export const SOLAR_ICONS = {
  // Direction and navigation
  ArrowDown: 'arrow-down-linear',
  ArrowLeft: 'arrow-left-linear',
  ArrowRight: 'arrow-right-linear',
  ArrowUp: 'arrow-up-linear',
  ArrowUturnRight: 'undo-right-round-linear',
  ChevronDown: 'alt-arrow-down-linear',
  ChevronLeft: 'alt-arrow-left-linear',
  ChevronRight: 'alt-arrow-right-linear',
  ChevronUp: 'alt-arrow-up-linear',
  Close: 'close-linear',
  Command: 'command-linear',
  ExternalLink: 'square-share-line-linear',
  Keyboard: 'keyboard-linear',
  MoreHorizontal: 'menu-dots-linear',
  PanelLeft: 'sidebar-minimalistic-linear',

  // Notes, files, and the graph
  Archive: 'archive-minimalistic-linear',
  ArchiveBox: 'archive-linear',
  Book: 'book-linear',
  Bookmark: 'bookmark-linear',
  Folder: 'folder-linear',
  FolderMove: 'folder-path-connect-linear',
  FolderOpen: 'folder-open-linear',
  FolderPlus: 'add-folder-linear',
  Hash: 'hashtag-linear',
  Image: 'gallery-minimalistic-linear',
  Link: 'link-minimalistic-2-linear',
  Note: 'document-text-linear',
  NoteDownload: 'file-download-linear',
  NoteEdit: 'pen-new-square-linear',
  NotePlus: 'document-add-linear',
  Notebook: 'notebook-minimalistic-linear',
  Notes: 'documents-minimalistic-linear',
  Paperclip: 'paperclip-linear',
  Pin: 'pin-linear',
  Star: 'star-linear',

  // Editing
  Checklist: 'checklist-minimalistic-linear',
  Copy: 'copy-linear',
  Download: 'download-minimalistic-linear',
  List: 'list-linear',
  Microphone: 'microphone-linear',
  Pencil: 'pen-2-linear',
  Play: 'play-linear',
  Plus: 'add-linear',
  Replace: 'transfer-horizontal-linear',
  Trash: 'trash-bin-minimalistic-linear',
  Undo: 'undo-left-round-linear',

  // State and feedback
  AlertTriangle: 'danger-triangle-linear',
  CheckCircle: 'check-circle-linear',
  Circle: 'record-linear',
  CloseCircle: 'close-circle-linear',
  Flag: 'flag-2-linear',
  Info: 'info-circle-linear',
  Lock: 'lock-keyhole-minimalistic-linear',
  LockOpen: 'lock-keyhole-minimalistic-unlocked-linear',

  // Search and filtering
  Filter: 'filter-linear',
  Locate: 'gps-linear',
  Search: 'minimalistic-magnifer-linear',
  Sliders: 'tuning-2-linear',

  // Time
  AlarmClock: 'alarm-linear',
  Calendar: 'calendar-minimalistic-linear',
  CalendarClock: 'calendar-mark-linear',
  CalendarDays: 'calendar-linear',
  History: 'history-linear',

  // Sync, storage, and sharing
  Cloud: 'cloud-linear',
  CloudOff: 'cloud-cross-linear',
  CloudUpload: 'cloud-upload-linear',
  HardDrive: 'ssd-square-linear',
  Layers: 'layers-minimalistic-linear',
  Refresh: 'refresh-linear',
  Restart: 'restart-linear',
  Share: 'share-linear',
  Shuffle: 'shuffle-linear',

  // Appearance
  LayoutGrid: 'widget-linear',
  LayoutTemplate: 'widget-5-linear',
  Monitor: 'monitor-linear',
  Moon: 'moon-linear',
  MoonStars: 'moon-stars-linear',
  Sun: 'sun-linear',
  SunDim: 'sun-2-linear',

  // AI, chat, and integrations
  Bot: 'bot-linear',
  Chat: 'chat-round-linear',
  Inbox: 'inbox-linear',
  Plug: 'plug-circle-linear',
  Settings: 'settings-minimalistic-linear',
  Sparkles: 'stars-linear',
  User: 'user-rounded-linear',
}
