import { useEffect, useRef, useState } from 'react'
import { normalizeChatSystemPrompt } from '@reflect/core'

interface UseChatSystemPromptDraftOptions {
  persistedPrompt: string
  updateSettings: (patch: { chatSystemPrompt: string }) => void
}

interface ChatSystemPromptDraft {
  value: string
  update: (value: string) => void
  save: () => void
}

/** Keeps an editable system-prompt draft and persists it on blur, close, or unmount. */
export function useChatSystemPromptDraft({
  persistedPrompt,
  updateSettings,
}: UseChatSystemPromptDraftOptions): ChatSystemPromptDraft {
  const [draft, setDraft] = useState(persistedPrompt)
  const [dirty, setDirty] = useState(false)
  const draftRef = useRef(draft)
  const dirtyRef = useRef(dirty)
  const updateSettingsRef = useRef(updateSettings)

  useEffect(() => {
    updateSettingsRef.current = updateSettings
  }, [updateSettings])

  const save = (): void => {
    if (!dirtyRef.current) {
      return
    }
    const normalized = normalizeChatSystemPrompt(draftRef.current)
    draftRef.current = normalized
    dirtyRef.current = false
    setDraft(normalized)
    setDirty(false)
    updateSettingsRef.current({ chatSystemPrompt: normalized })
  }

  useEffect(
    () => () => {
      if (dirtyRef.current) {
        dirtyRef.current = false
        updateSettingsRef.current({
          chatSystemPrompt: normalizeChatSystemPrompt(draftRef.current),
        })
      }
    },
    [],
  )

  return {
    value: dirty ? draft : persistedPrompt,
    update: (value) => {
      draftRef.current = value
      dirtyRef.current = true
      setDraft(value)
      setDirty(true)
    },
    save,
  }
}
