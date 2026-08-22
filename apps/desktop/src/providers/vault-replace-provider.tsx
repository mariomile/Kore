import {
  createContext,
  useCallback,
  use,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

/**
 * Open state for the vault-wide Replace dialog, provided once per workspace
 * so the `note.replaceInVault` command (via CommandContext), the note find
 * bar's hand-off, and the dialog itself share one definition of "open" — the
 * same shape as the palette's and the cheat-sheet's providers.
 *
 * The seed rides along because the find bar hands its query over: ⌘F for this
 * note, then the same needle across the vault, without retyping. Only the
 * needle is ever seeded — never the replacement, which the user must type
 * deliberately every time.
 */

interface VaultReplaceContextValue {
  open: boolean
  /** The needle to prefill, '' when opened cold. */
  seed: string
  openVaultReplace: (seed?: string) => void
  closeVaultReplace: () => void
}

const VaultReplaceContext = createContext<VaultReplaceContextValue | null>(null)

export function VaultReplaceProvider({ children }: { children: ReactNode }): ReactElement {
  const [state, setState] = useState({ open: false, seed: '' })

  const openVaultReplace = useCallback((seed = '') => {
    setState({ open: true, seed })
  }, [])
  const closeVaultReplace = useCallback(() => {
    setState((current) => ({ ...current, open: false }))
  }, [])

  const value = useMemo<VaultReplaceContextValue>(
    () => ({ ...state, openVaultReplace, closeVaultReplace }),
    [state, openVaultReplace, closeVaultReplace],
  )
  return <VaultReplaceContext value={value}>{children}</VaultReplaceContext>
}

export function useVaultReplaceDialog(): VaultReplaceContextValue {
  const context = use(VaultReplaceContext)
  if (!context) {
    throw new Error('useVaultReplaceDialog must be used within a VaultReplaceProvider')
  }
  return context
}
