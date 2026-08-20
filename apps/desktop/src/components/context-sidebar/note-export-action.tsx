import { useState, type ReactElement } from 'react'
import { FileDown } from 'lucide-react'
import { ShortcutKeys } from '@/components/shortcut-keys'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { runNoteExport } from '@/lib/note-export'
import { useGraph } from '@/providers/graph-provider'

interface NoteExportActionProps {
  /** Graph-relative path of the note the action operates on. */
  path: string
  /** Keybinding hint, from the matching command definition. */
  keybinding?: string | null
}

/**
 * Styled HTML export as a Note actions button — the mouse-reachable twin of
 * the `note.export` command. Always offered (the export is a local save, so
 * even private notes qualify); `runNoteExport` owns the save dialog and all
 * status-line feedback.
 */
export function NoteExportAction({ path, keybinding = null }: NoteExportActionProps): ReactElement {
  const { graph } = useGraph()
  const [isExporting, setIsExporting] = useState(false)

  const onExport = async (): Promise<void> => {
    const generation = graph?.generation
    if (generation === undefined) {
      return
    }
    setIsExporting(true)
    try {
      await runNoteExport(path, generation)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => void onExport()}
            disabled={isExporting}
            className="group relative flex w-full items-center space-x-2 rounded-lg px-3 py-2 text-start transition-colors duration-100 hover:bg-surface-hover disabled:opacity-50"
          >
            <span className="flex h-5 w-5 flex-none items-center justify-center text-text-muted transition-colors duration-100 group-hover:text-text">
              <FileDown size={14} aria-hidden />
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              {isExporting ? 'Exporting…' : 'Export as HTML'}
            </span>
            {keybinding !== null ? (
              <ShortcutKeys binding={keybinding} className="invisible group-hover:visible" />
            ) : null}
          </button>
        }
      />
      <TooltipContent>
        Saves a styled, self-contained HTML file — open it in a browser and print for a PDF
      </TooltipContent>
    </Tooltip>
  )
}
