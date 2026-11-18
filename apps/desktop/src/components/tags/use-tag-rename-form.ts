import { useEffect, useState } from 'react'
import { normalizeTagInput, tagRenameProblem } from '@kore/core'
import {
  useTagRename,
  type TagRenameOutcome,
  type TagRenamePreview,
} from '@/lib/tags/use-tag-rename'

/** Wait this long after the last keystroke before reading the vault. */
const PREVIEW_DELAY_MS = 250

/** What the last action did, for the result screen. */
export interface TagRenameResult {
  readonly kind: 'renamed' | 'undone'
  /** The name the rename landed on, display casing. */
  readonly to: string
  readonly outcome: TagRenameOutcome
}

export interface TagRenameForm {
  value: string
  setValue: (value: string) => void
  /** Why the typed name can't be used, or null. */
  problem: string | null
  /** The preview for the name as typed now, or null while it is computed. */
  preview: TagRenamePreview | null
  /** Set once the rename (or its undo) ran; the form shows the result. */
  result: TagRenameResult | null
  canSubmit: boolean
  submit: () => Promise<void>
  undo: () => Promise<void>
  canUndo: boolean
  isBusy: boolean
}

/**
 * The state behind the rename dialog and the phone's sheet, so the two differ
 * only in layout. The preview is stored with the name it describes: typing
 * on makes it stale by derivation, with no reset to race the next read.
 */
export function useTagRenameForm(tag: string): TagRenameForm {
  const actions = useTagRename()
  const [value, setValue] = useState(tag)
  const [stored, setStored] = useState<TagRenamePreview | null>(null)
  const [result, setResult] = useState<TagRenameResult | null>(null)
  const rename = { from: tag, to: value }
  const problem = tagRenameProblem(rename)
  const preview = stored !== null && stored.rename.to === value && problem === null ? stored : null
  const { preview: readPreview } = actions

  useEffect(() => {
    if (tagRenameProblem({ from: tag, to: value }) !== null) {
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      void readPreview({ from: tag, to: value }).then((next) => {
        if (active) setStored(next)
      })
    }, PREVIEW_DELAY_MS)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [tag, value, readPreview])

  const changes = preview === null ? 0 : preview.plan.writes.length - preview.blocked.length
  const canSubmit =
    preview !== null && !actions.isBusy && (changes > 0 || preview.plan.moves.length > 0)

  return {
    value,
    setValue,
    problem: value === tag ? null : problem,
    preview,
    result,
    canSubmit,
    submit: async () => {
      if (preview === null) return
      const outcome = await actions.apply(preview)
      setResult({ kind: 'renamed', to: normalizeTagInput(value), outcome })
    },
    undo: async () => {
      const outcome = await actions.undo()
      setStored(null)
      setResult({ kind: 'undone', to: normalizeTagInput(value), outcome })
    },
    canUndo: actions.canUndo,
    isBusy: actions.isBusy,
  }
}
