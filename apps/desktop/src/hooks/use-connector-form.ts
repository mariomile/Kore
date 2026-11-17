import { useState, type FormEvent } from 'react'
import { connectorPathPreview, errorMessage, type Connector } from '@kore/core'
import {
  syncEveryFromKey,
  type ConnectorView,
  type UseConnectorsResult,
} from '@/hooks/use-connectors'

/**
 * The state behind one integration's settings, shared by the desktop card
 * and the iPhone sheet so the two only differ in layout.
 */

export interface ConnectForm {
  readonly token: string
  setToken(token: string): void
  readonly importHistory: boolean
  setImportHistory(on: boolean): void
  readonly busy: boolean
  readonly error: string | null
  /** Whether the form can be sent: a token typed and no check running. */
  readonly canSubmit: boolean
  /** The form's submit handler: verifies and stores the credential. */
  onSubmit(event: FormEvent): void
}

/** The credential form shown while a connector is disconnected. */
export function useConnectForm(connector: Connector, actions: UseConnectorsResult): ConnectForm {
  const [token, setToken] = useState('')
  const [importHistory, setImportHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await actions.connect(connector.id, token, importHistory)
      setToken('')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return {
    token,
    setToken,
    importHistory,
    setImportHistory,
    busy,
    error,
    canSubmit: !busy && token.trim() !== '',
    onSubmit(event) {
      event.preventDefault()
      void connect()
    },
  }
}

export interface ConnectorFields {
  /** The saved values, the connector's defaults filled in. */
  readonly folder: string
  readonly pattern: string
  readonly tags: string
  readonly heading: string
  /** Where a typical note lands, following the fields as they are typed. */
  readonly preview: string
  /** The last folder or pattern the user typed that was rejected. */
  readonly problem: string | null
  setProblem(problem: string | null): void
  setFolderDraft(draft: string | null): void
  setPatternDraft(draft: string | null): void
  /** The frequency as a picker key (`SYNC_EVERY_OPTIONS`), and its setter. */
  readonly frequency: string
  setFrequency(key: string): void
}

/** The fields of a connected connector, with the live path preview. */
export function useConnectorFields(
  view: ConnectorView,
  actions: UseConnectorsResult,
): ConnectorFields {
  const { connector, settings } = view
  const [problem, setProblem] = useState<string | null>(null)
  const [folderDraft, setFolderDraft] = useState<string | null>(null)
  const [patternDraft, setPatternDraft] = useState<string | null>(null)
  const folder = settings.folder ?? connector.defaultFolder
  const pattern = settings.pattern ?? connector.defaultPattern

  return {
    folder,
    pattern,
    tags: (settings.tags ?? connector.defaultTags).join(', '),
    heading: settings.dailyHeading ?? connector.dailyHeading,
    preview: connectorPathPreview(connector, folderDraft ?? folder, patternDraft ?? pattern),
    problem,
    setProblem,
    setFolderDraft,
    setPatternDraft,
    frequency: String(settings.syncEvery),
    setFrequency(key) {
      const every = syncEveryFromKey(key)
      if (every !== undefined) {
        actions.setSyncEvery(connector.id, every)
      }
    },
  }
}
