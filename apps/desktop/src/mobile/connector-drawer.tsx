import type { ReactElement, ReactNode } from 'react'
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
import { useConnectForm, useConnectorFields } from '@/hooks/use-connector-form'
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
  const { connector } = view
  return (
    <>
      <DrawerTitle>{connector.label}</DrawerTitle>
      <DrawerBody>
        {view.connected === true ? (
          <ConnectedGroups view={view} actions={actions} />
        ) : view.connected === false ? (
          <ConnectForm view={view} actions={actions} />
        ) : (
          // The keychain read is pending: no form to submit over a stored key.
          <p className="px-4 text-sm text-text-muted">{connector.description}</p>
        )}
      </DrawerBody>
    </>
  )
}

function ConnectForm({
  view,
  actions,
}: {
  view: ConnectorView
  actions: UseConnectorsResult
}): ReactElement {
  const { connector } = view
  const form = useConnectForm(connector, actions)
  return (
    <form className="flex flex-col gap-5" onSubmit={form.onSubmit}>
      <SettingsGroup footer={connector.description}>
        <FieldRow label={connector.tokenLabel}>
          <Input
            type="password"
            value={form.token}
            onChange={(event) => form.setToken(event.target.value)}
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
          checked={form.importHistory}
          onCheckedChange={form.setImportHistory}
        />
      </SettingsGroup>
      {form.error !== null ? <p className="px-4 text-sm text-destructive">{form.error}</p> : null}
      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" disabled={!form.canSubmit}>
          {form.busy ? 'Checking…' : 'Connect'}
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
  )
}

function ConnectedGroups({
  view,
  actions,
}: {
  view: ConnectorView
  actions: UseConnectorsResult
}): ReactElement {
  const { connector, settings } = view
  const { settings: appSettings } = useSettings()
  const fields = useConnectorFields(view, actions)

  return (
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
              value={fields.frequency}
              onChange={(event) => fields.setFrequency(event.target.value)}
              className="min-w-0 appearance-none bg-transparent pr-5 text-right text-[15px] outline-none"
            >
              {SYNC_EVERY_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
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

      <SettingsGroup header="Destination" footer={fields.preview}>
        <FieldRow label="Folder">
          <CommitInput
            value={fields.folder}
            placeholder="Vault root"
            onCommit={(value) => actions.setFolder(connector.id, value)}
            onProblem={fields.setProblem}
            onDraft={fields.setFolderDraft}
            className={FIELD_CLASS}
          />
        </FieldRow>
        <FieldRow label="File name">
          <CommitInput
            value={fields.pattern}
            placeholder={connector.defaultPattern}
            onCommit={(value) => actions.setPattern(connector.id, value)}
            onProblem={fields.setProblem}
            onDraft={fields.setPatternDraft}
            autoCapitalize="off"
            autoCorrect="off"
            className={FIELD_CLASS}
          />
        </FieldRow>
        <FieldRow label="Tags">
          <CommitInput
            value={fields.tags}
            placeholder={connector.defaultTags.join(', ')}
            onCommit={(value) => actions.setTags(connector.id, value)}
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
        footer={`Each new note gets a line under “${fields.heading}” in that day’s note.`}
      >
        <SettingsSwitchRow
          label="Link in daily note"
          checked={settings.dailyLink}
          onCheckedChange={(on) => actions.setDailyLink(connector.id, on)}
        />
        {settings.dailyLink ? (
          <FieldRow label="Heading">
            <CommitInput
              value={fields.heading}
              placeholder={connector.dailyHeading}
              onCommit={(value) => actions.setDailyHeading(connector.id, value)}
              className={FIELD_CLASS}
            />
          </FieldRow>
        ) : null}
      </SettingsGroup>

      {fields.problem !== null ? (
        <p className="px-4 text-sm text-destructive">{fields.problem}</p>
      ) : null}

      <SettingsGroup footer="Kore only adds. Notes you edit are never overwritten.">
        <SettingsActionRow
          label="Disconnect"
          tone="destructive"
          onPress={() => void actions.disconnect(connector.id)}
        />
      </SettingsGroup>
    </div>
  )
}
