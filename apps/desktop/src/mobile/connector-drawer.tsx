import { useState, type ReactElement, type ReactNode } from 'react'
import { connectorPathPreview, errorMessage } from '@kore/core'
import { ChevronDown } from '@/components/icons'
import { CommitInput } from '@/components/settings/commit-input'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerBody, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import {
  connectorStatusText,
  SYNC_EVERY_OPTIONS,
  type ConnectorView,
  type UseConnectorsResult,
} from '@/hooks/use-connectors'
import { openUrlSync } from '@/lib/open-url'
import { SettingsActionRow, SettingsGroup, SettingsSwitchRow } from '@/mobile/settings-list'
import { useSettings } from '@/providers/settings-provider'

interface ConnectorDrawerProps {
  /** The connector shown; kept after close so the exit animation has content. */
  view: ConnectorView | null
  open: boolean
  onOpenChange: (open: boolean) => void
  actions: UseConnectorsResult
}

/**
 * The mobile sheet for one integration, the iPhone side of the desktop
 * Integrations card: connect, then sync, destination (with the path
 * preview), content, and the daily-note link, in inset-grouped lists.
 */
export function ConnectorDrawer({
  view,
  open,
  onOpenChange,
  actions,
}: ConnectorDrawerProps): ReactElement {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-label={view?.connector.label ?? 'Integration'}>
        {view !== null ? (
          <ConnectorSheet key={view.connector.id} view={view} actions={actions} />
        ) : null}
      </DrawerContent>
    </Drawer>
  )
}

const ROW_CLASS = 'flex min-h-11 w-full items-center gap-3 px-4 py-1.5 text-[15px]'
const FIELD_CLASS =
  'h-8 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-right text-[15px] text-text-secondary shadow-none focus-visible:border-0 dark:bg-transparent md:text-[15px]'

function FieldRow({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <label className={ROW_CLASS}>
      <span className="shrink-0">{label}</span>
      {children}
    </label>
  )
}

function ConnectorSheet({
  view,
  actions,
}: {
  view: ConnectorView
  actions: UseConnectorsResult
}): ReactElement {
  const { connector, settings } = view
  const { settings: appSettings } = useSettings()
  const [token, setToken] = useState('')
  const [importHistory, setImportHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [folderDraft, setFolderDraft] = useState<string | null>(null)
  const [patternDraft, setPatternDraft] = useState<string | null>(null)
  const folder = settings.folder ?? connector.defaultFolder
  const pattern = settings.pattern ?? connector.defaultPattern
  const heading = settings.dailyHeading ?? connector.dailyHeading

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

  if (view.connected === null) {
    // The keychain read is pending: no form to submit over a stored key.
    return (
      <>
        <DrawerTitle>{connector.label}</DrawerTitle>
        <DrawerBody>
          <p className="px-4 text-sm text-text-muted">{connector.description}</p>
        </DrawerBody>
      </>
    )
  }

  if (view.connected === false) {
    return (
      <>
        <DrawerTitle>{connector.label}</DrawerTitle>
        <DrawerBody>
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              void connect()
            }}
          >
            <SettingsGroup footer={connector.description}>
              <FieldRow label={connector.tokenLabel}>
                <Input
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Paste here"
                  aria-label={`${connector.label} ${connector.tokenLabel}`}
                  autoComplete="off"
                  className={FIELD_CLASS}
                />
              </FieldRow>
            </SettingsGroup>
            <SettingsGroup footer="Leave off if another app already wrote them into this vault.">
              <SettingsSwitchRow
                label="Import past items"
                checked={importHistory}
                onCheckedChange={setImportHistory}
              />
            </SettingsGroup>
            {error !== null ? <p className="px-4 text-sm text-destructive">{error}</p> : null}
            <div className="flex flex-col gap-2">
              <Button type="submit" size="lg" disabled={busy || token.trim() === ''}>
                {busy ? 'Checking…' : 'Connect'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="lg"
                onClick={() => openUrlSync(connector.tokenUrl)}
              >
                Get {connector.tokenNoun}
              </Button>
            </div>
          </form>
        </DrawerBody>
      </>
    )
  }

  return (
    <>
      <DrawerTitle>{connector.label}</DrawerTitle>
      <DrawerBody>
        <div className="flex flex-col gap-5">
          <SettingsGroup footer={connectorStatusText(view, appSettings)}>
            <SettingsSwitchRow
              label="Sync"
              checked={settings.enabled}
              onCheckedChange={(checked) => actions.setEnabled(connector.id, checked)}
            />
            <label className={ROW_CLASS}>
              <span className="shrink-0">Frequency</span>
              <span className="relative ml-auto flex min-w-0 items-center gap-1 text-text-secondary">
                <select
                  value={String(settings.syncEvery)}
                  onChange={(event) => {
                    const choice = SYNC_EVERY_OPTIONS.find(
                      (option) => String(option.value) === event.target.value,
                    )
                    if (choice !== undefined) {
                      actions.setSyncEvery(connector.id, choice.value)
                    }
                  }}
                  className="min-w-0 appearance-none bg-transparent pr-5 text-right text-[15px] outline-none"
                >
                  {SYNC_EVERY_OPTIONS.map((option) => (
                    <option key={String(option.value)} value={String(option.value)}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden className="pointer-events-none absolute right-0 size-4" />
              </span>
            </label>
            <SettingsActionRow
              label={view.running ? 'Syncing…' : 'Sync now'}
              pending={view.running}
              disabled={!settings.enabled}
              onPress={() => actions.syncNow(connector.id)}
            />
          </SettingsGroup>

          <SettingsGroup
            header="Destination"
            footer={connectorPathPreview(connector, folderDraft ?? folder, patternDraft ?? pattern)}
          >
            <FieldRow label="Folder">
              <CommitInput
                value={folder}
                placeholder="Vault root"
                onCommit={(value) => actions.setFolder(connector.id, value)}
                onProblem={setError}
                onDraft={setFolderDraft}
                className={FIELD_CLASS}
              />
            </FieldRow>
            <FieldRow label="File name">
              <CommitInput
                value={pattern}
                placeholder={connector.defaultPattern}
                onCommit={(value) => actions.setPattern(connector.id, value)}
                onProblem={setError}
                onDraft={setPatternDraft}
                autoCapitalize="off"
                autoCorrect="off"
                className={FIELD_CLASS}
              />
            </FieldRow>
            <FieldRow label="Tags">
              <CommitInput
                value={(settings.tags ?? connector.defaultTags).join(', ')}
                placeholder={connector.defaultTags.join(', ')}
                onCommit={(value) => {
                  actions.setTags(connector.id, value)
                  return null
                }}
                autoCapitalize="off"
                className={FIELD_CLASS}
              />
            </FieldRow>
          </SettingsGroup>

          {connector.options.length > 0 ? (
            <SettingsGroup header="Content">
              {connector.options.map((option) => (
                <SettingsSwitchRow
                  key={option.key}
                  label={option.label}
                  checked={settings.options[option.key] === true}
                  onCheckedChange={(on) => actions.setOption(connector.id, option.key, on)}
                />
              ))}
            </SettingsGroup>
          ) : null}

          <SettingsGroup
            header="Daily note"
            footer={`Each new note gets a line under “${heading}” in that day’s note.`}
          >
            <SettingsSwitchRow
              label="Link in daily note"
              checked={settings.dailyLink}
              onCheckedChange={(on) => actions.setDailyLink(connector.id, on)}
            />
            {settings.dailyLink ? (
              <FieldRow label="Heading">
                <CommitInput
                  value={heading}
                  placeholder={connector.dailyHeading}
                  onCommit={(value) => {
                    actions.setDailyHeading(connector.id, value)
                    return null
                  }}
                  className={FIELD_CLASS}
                />
              </FieldRow>
            ) : null}
          </SettingsGroup>

          {error !== null ? <p className="px-4 text-sm text-destructive">{error}</p> : null}

          <SettingsGroup footer="Kore only adds. Notes you edit are never overwritten.">
            <SettingsActionRow
              label="Disconnect"
              tone="destructive"
              onPress={() => void actions.disconnect(connector.id)}
            />
          </SettingsGroup>
        </div>
      </DrawerBody>
    </>
  )
}
