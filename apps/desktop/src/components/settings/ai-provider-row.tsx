import type { ReactElement } from 'react'
import { Trash2 } from 'lucide-react'
import {
  aiModelLabel,
  aiProvider,
  aiProviderRequiresApiKey,
  errorMessage,
  isCliAgentProvider,
  type AiProviderConfig,
} from '@reflect/core'
import { Button } from '@/components/ui/button'
import { startOperation } from '@/lib/operations'
import { ModelCombobox } from './model-combobox'
import { brandForProvider, ProviderLogo } from './provider-brands'

interface AiProviderRowProps {
  config: AiProviderConfig
  /** Whether this entry is the (resolved) app-wide default. */
  isDefault: boolean
  /** Make this entry the app-wide default. */
  onMakeDefault: (id: string) => void
  /** Change the default model used by this provider entry. */
  onSetDefaultModel: (id: string, model: string) => void
  /** Remove the entry and its keychain secret; rejects on failure. */
  onRemove: (id: string) => Promise<void>
}

/**
 * One configured AI provider in the settings list: provider + default model,
 * the stored key's trailing characters, and the default/remove controls. The
 * row owns its own removal (including surfacing a keychain failure as an
 * operation).
 */
export function AiProviderRow({
  config,
  isDefault,
  onMakeDefault,
  onSetDefaultModel,
  onRemove,
}: AiProviderRowProps): ReactElement {
  const provider = aiProvider(config.provider)
  const providerLabel = provider.label
  // Subscription (CLI) entries have no default model of their own — the
  // model is picked per conversation in the chat selector.
  const isCliEntry = isCliAgentProvider(config.provider)
  const name = isCliEntry
    ? providerLabel
    : `${providerLabel} — ${aiModelLabel(config.provider, config.model)}`
  const showKeyHint = aiProviderRequiresApiKey(config.provider) || config.keyHint !== ''
  const brand = brandForProvider(
    config.provider,
    config.provider === 'openai-compatible' ? config.baseUrl : undefined,
  )
  const modeLabel = brand?.modes.find((mode) => mode.provider === config.provider)?.label ?? null

  const remove = (): void => {
    onRemove(config.id).catch((error: unknown) => {
      startOperation(`Removing ${name}`).fail(errorMessage(error))
    })
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_12rem_auto] items-center gap-3 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {brand ? (
          <span className="flex size-8 flex-none items-center justify-center rounded-lg border border-border bg-surface-sunken text-text">
            <ProviderLogo brand={brand} className="size-4.5" />
          </span>
        ) : null}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-text">
              {brand?.name ?? providerLabel}
            </span>
            {modeLabel !== null ? (
              <span className="rounded-full bg-surface-hover px-1.5 py-px text-[10px] font-medium text-text-secondary">
                {modeLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-text-muted">
            {showKeyHint ? (
              <>
                API key <span className="font-mono">·····{config.keyHint}</span>
              </>
            ) : (
              'No API key'
            )}
          </p>
          {config.provider === 'openai-compatible' ? (
            <p className="mt-0.5 truncate text-xs text-text-muted">{config.baseUrl}</p>
          ) : null}
        </div>
      </div>
      {isCliEntry ? (
        <p className="text-xs text-text-muted">Model picked in chat</p>
      ) : (
        <ModelCombobox
          value={config.model}
          provider={config.provider}
          models={provider.models}
          onChange={(model) => onSetDefaultModel(config.id, model)}
          ariaLabel={`Default model for ${providerLabel}`}
        />
      )}
      <div className="flex shrink-0 items-center gap-2">
        {isDefault ? (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-soft-text">
            Default
          </span>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onMakeDefault(config.id)}
            className="text-text-secondary hover:bg-surface-hover hover:text-text"
          >
            Make default
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${name}`}
          onClick={remove}
          className="text-text-muted hover:bg-surface-hover hover:text-text"
        >
          <Trash2 aria-hidden strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  )
}
