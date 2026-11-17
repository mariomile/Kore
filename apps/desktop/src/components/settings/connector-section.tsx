import { useId, type ReactElement, type ReactNode } from 'react'
import type { ConnectorId } from '@kore/core'
import { ExternalLink, Refresh } from '@/components/icons'
import { InlineAlert } from '@/components/inline-alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useConnectForm, useConnectorFields } from '@/hooks/use-connector-form'
import {
  connectorStatusText,
  SYNC_EVERY_OPTIONS,
  useConnectors,
  type ConnectorView,
  type UseConnectorsResult,
} from '@/hooks/use-connectors'
import { openUrlSync } from '@/lib/open-url'
import { cn } from '@/lib/utils'
import { useSettings } from '@/providers/settings-provider'
import { CommitInput } from './commit-input'
import { SettingsSection } from './section'
import { SettingsSwitchField } from './switch-field'

/** Width every trailing control shares, so their edges line up down the card. */
const CONTROL_CLASS = 'w-60 shrink-0'

/**
 * One source's card on the Integrations page (Granola, Readwise): the
 * credential form while disconnected; once connected, when it syncs, where
 * its notes land (with a live preview of the path), what they hold, and the
 * optional link in each day's daily note. Every note stays plain markdown.
 */
export function ConnectorSection({ id }: { id: ConnectorId }): ReactElement | null {
  const actions = useConnectors()
  const view = actions.items.find((item) => item.connector.id === id)
  if (view === undefined) {
    return null
  }
  return (
    <SettingsSection id={id}>
      {view.connected === true ? (
        <ConnectedRows view={view} actions={actions} />
      ) : view.connected === false ? (
        <ConnectForm view={view} actions={actions} />
      ) : (
        // The keychain read is pending: no form a user could submit over a
        // stored key, and no flash of "not connected".
        <p className="px-4 py-3.5 text-sm text-text-secondary">{view.connector.description}</p>
      )}
    </SettingsSection>
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
    <form className="px-4 py-3.5" onSubmit={form.onSubmit}>
      <p className="text-sm text-text-secondary">{connector.description}</p>
      <div className="mt-3 flex items-center gap-2">
        <Input
          type="password"
          value={form.token}
          onChange={(event) => form.setToken(event.target.value)}
          placeholder={connector.tokenLabel}
          aria-label={`${connector.label} ${connector.tokenLabel}`}
          autoComplete="off"
          className="min-w-0 flex-1 font-mono text-xs"
        />
        <Button type="submit" size="sm" disabled={!form.canSubmit}>
          {form.busy ? 'Checking…' : 'Connect'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => openUrlSync(connector.tokenUrl)}
        >
          Get {connector.tokenNoun}
          <ExternalLink aria-hidden />
        </Button>
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-text-secondary">
        <Checkbox
          checked={form.importHistory}
          onCheckedChange={(next) => form.setImportHistory(next === true)}
        />
        Also import items from before today (leave off if another app already wrote them here)
      </label>
      {form.error !== null ? (
        <div className="mt-3">
          <InlineAlert tone="warning">{form.error}</InlineAlert>
        </div>
      ) : null}
    </form>
  )
}

function ConnectedRows({
  view,
  actions,
}: {
  view: ConnectorView
  actions: UseConnectorsResult
}): ReactElement {
  const { connector, settings } = view
  const { settings: appSettings } = useSettings()
  const fields = useConnectorFields(view, actions)
  const switchId = useId()
  const patternFields = connector.patternFields.map((field) => `{${field}}`).join(' ')

  return (
    <>
      <div className="flex items-center justify-between gap-6 px-4 py-3.5">
        <div className="min-w-0">
          <div id={switchId} className="text-sm font-medium text-text">
            Sync
          </div>
          <p className="mt-0.5 truncate text-xs text-text-muted">
            {connectorStatusText(view, appSettings)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!settings.enabled || view.running}
            onClick={() => actions.syncNow(connector.id)}
          >
            <Refresh aria-hidden className={view.running ? 'animate-spin' : undefined} />
            Sync now
          </Button>
          <Switch
            aria-labelledby={switchId}
            checked={settings.enabled}
            onCheckedChange={(checked) => actions.setEnabled(connector.id, checked)}
          />
        </div>
      </div>

      <Row label="Frequency" description="How often new items are fetched while Kore is open.">
        <Select
          value={fields.frequency}
          items={SYNC_EVERY_OPTIONS.map((option) => ({ value: option.key, label: option.label }))}
          onValueChange={(value) => {
            if (value !== null) {
              fields.setFrequency(value)
            }
          }}
        >
          <SelectTrigger aria-label="Frequency" className={CONTROL_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SYNC_EVERY_OPTIONS.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      <div className="px-4 py-3.5">
        <InlineRow label="Folder" description="Where new notes go. Empty means the vault root.">
          <CommitInput
            aria-label="Folder"
            value={fields.folder}
            placeholder="Vault root"
            onCommit={(value) => actions.setFolder(connector.id, value)}
            onProblem={fields.setProblem}
            onDraft={fields.setFolderDraft}
            className={CONTROL_CLASS}
          />
        </InlineRow>
        <InlineRow label="File name" description={`Fields: ${patternFields}`} className="mt-3">
          <CommitInput
            aria-label="File name"
            value={fields.pattern}
            placeholder={connector.defaultPattern}
            onCommit={(value) => actions.setPattern(connector.id, value)}
            onProblem={fields.setProblem}
            onDraft={fields.setPatternDraft}
            className={cn(CONTROL_CLASS, 'font-mono text-xs md:text-xs')}
          />
        </InlineRow>
        <div className="mt-3 flex items-center justify-between gap-4 rounded-md bg-surface-sunken px-2.5 py-1.5 text-[11px]">
          <span className="min-w-0 truncate font-mono text-text-secondary" title={fields.preview}>
            {fields.preview}
          </span>
          <span className="shrink-0 text-text-muted">A / makes a subfolder</span>
        </div>
      </div>

      <Row label="Tags" description="Added to every new note, comma-separated.">
        <CommitInput
          aria-label="Tags"
          value={fields.tags}
          placeholder={connector.defaultTags.join(', ')}
          onCommit={(value) => actions.setTags(connector.id, value)}
          className={CONTROL_CLASS}
        />
      </Row>

      {connector.options.map((option) => (
        <SettingsSwitchField
          key={option.key}
          legend={option.label}
          description={option.description}
          checked={settings.options[option.key] === true}
          onCheckedChange={(on) => actions.setOption(connector.id, option.key, on)}
        />
      ))}

      <div>
        <SettingsSwitchField
          legend="Link in daily note"
          description={`Each new note gets a line under “${fields.heading}” in that day’s note.`}
          checked={settings.dailyLink}
          onCheckedChange={(on) => actions.setDailyLink(connector.id, on)}
        />
        {settings.dailyLink ? (
          <div className="-mt-1 px-4 pb-3.5">
            <InlineRow label="Heading" description="Created at the end of the note if missing.">
              <CommitInput
                aria-label="Daily note heading"
                value={fields.heading}
                placeholder={connector.dailyHeading}
                onCommit={(value) => actions.setDailyHeading(connector.id, value)}
                className={CONTROL_CLASS}
              />
            </InlineRow>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <p className="text-xs text-text-muted">
          Kore only adds. Notes you edit are never overwritten.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-mr-2.5 text-text-muted hover:text-destructive"
          onClick={() => void actions.disconnect(connector.id)}
        >
          Disconnect
        </Button>
      </div>

      {fields.problem !== null ? (
        <div className="px-4 py-3">
          <InlineAlert tone="warning">{fields.problem}</InlineAlert>
        </div>
      ) : null}
    </>
  )
}

interface RowProps {
  label: string
  description: string
  children: ReactNode
  className?: string
}

/** A card row: copy on the left, one control pinned right. */
function Row({ label, description, children }: RowProps): ReactElement {
  return (
    <div className="px-4 py-3.5">
      <InlineRow label={label} description={description}>
        {children}
      </InlineRow>
    </div>
  )
}

/** The label/control pair of a {@link Row}, without the row's own padding. */
function InlineRow({ label, description, children, className }: RowProps): ReactElement {
  return (
    <div className={cn('flex items-center justify-between gap-6', className)}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-text">{label}</div>
        <p className="mt-0.5 text-xs text-text-muted">{description}</p>
      </div>
      {children}
    </div>
  )
}
