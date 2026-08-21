import { useEffect, useState, type ReactElement } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
  aiProvider,
  aiProviderRequiresApiKey,
  isCliAgentProvider,
  isHttpBaseUrl,
  isPlainHttpRemoteBaseUrl,
  type AiProviderId,
} from '@reflect/core'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { InlineAlert } from '@/components/inline-alert'
import { CodexSignIn } from '@/components/settings/codex-sign-in'
import { useAddAiProviderSubmit } from '@/hooks/use-add-ai-provider-submit'
import type { NewAiProvider } from '@/hooks/use-ai-providers'
import { cn } from '@/lib/utils'
import {
  PROVIDER_BRANDS,
  ProviderLogo,
  type ProviderBrand,
  type ProviderConnectionMode,
} from './provider-brands'

interface AddAiProviderDialogProps {
  /** Persists the new provider (keychain + settings); rejects on failure. */
  onAdd: (draft: NewAiProvider) => Promise<void>
  onClose: () => void
}

interface AddAiProviderForm {
  provider: AiProviderId
  model: string
  baseUrl: string
  apiKey: string
  isDefault: boolean
}

const FIELD_LABEL_CLASS = 'text-xs font-medium text-text-secondary'

/** The form values a connection mode starts from. */
function seedForMode(mode: ProviderConnectionMode): { model: string; baseUrl: string } {
  if (mode.seed !== undefined) {
    return mode.seed
  }
  return {
    model: aiProvider(mode.provider).models[0].id,
    baseUrl: mode.provider === 'openai-compatible' ? DEFAULT_OPENAI_COMPATIBLE_BASE_URL : '',
  }
}

/** Per-engine copy for the no-key connection block. */
const CLI_BINARIES: Record<string, { binary: string; hint: string }> = {
  'claude-cli': { binary: 'claude', hint: ' with your Claude account in a terminal' },
  'codex-cli': { binary: 'codex', hint: '' },
  'cursor-cli': { binary: 'cursor-agent', hint: ' with `cursor-agent login` in a terminal' },
}

/**
 * The "Add AI provider" modal, organized the way people think: pick the
 * brand (logo cards), then how to connect — Subscription through its coding
 * CLI, or an API key — where the brand offers both. No model choice here for
 * any provider: catalog providers seed their default silently (editable on
 * the row, overridden per conversation in the chat selector); only the
 * custom OpenAI-compatible endpoint asks for a model id, since there is no
 * catalog to fall back on. The verify-then-persist flow (rejected keys
 * inline, unreachable providers downgrading to "Save anyway") is
 * {@link useAddAiProviderSubmit}, shared with the mobile sheet. The key goes
 * to the OS keychain, never into the settings document.
 */
export function AddAiProviderDialog({ onAdd, onClose }: AddAiProviderDialogProps): ReactElement {
  const [brand, setBrand] = useState<ProviderBrand>(PROVIDER_BRANDS[0]!)
  const firstMode = PROVIDER_BRANDS[0]!.modes[0]!
  const { register, control, handleSubmit, setValue, formState } = useForm<AddAiProviderForm>({
    defaultValues: {
      provider: firstMode.provider,
      ...seedForMode(firstMode),
      apiKey: '',
      isDefault: false,
    },
  })
  const { submitError, unverified, resetUnverified, submit } = useAddAiProviderSubmit({
    onAdd,
    onDone: onClose,
  })

  // The dialog is conditionally mounted by its parent (not kept alive with
  // open=false), so Radix's Presence/onCloseAutoFocus path is bypassed when
  // Cancel or a successful submit calls onClose() directly.  Capturing focus
  // here and restoring it in the cleanup ensures the opener always gets focus
  // back regardless of which close path runs.
  useEffect(() => {
    const opener = document.activeElement
    return () => {
      if (opener instanceof HTMLElement) {
        opener.focus()
      }
    }
  }, [])

  const providerId = useWatch({ control, name: 'provider' })
  const baseUrlValue = useWatch({ control, name: 'baseUrl' })
  const provider = aiProvider(providerId)
  const mode = brand.modes.find((candidate) => candidate.provider === providerId) ?? brand.modes[0]!
  const isOpenAICompatible = provider.id === 'openai-compatible'
  const isCliProvider = isCliAgentProvider(provider.id)
  const apiKeyRequired = aiProviderRequiresApiKey(provider.id)

  const selectMode = (nextMode: ProviderConnectionMode): void => {
    const seed = seedForMode(nextMode)
    setValue('provider', nextMode.provider)
    setValue('model', seed.model)
    setValue('baseUrl', seed.baseUrl)
    resetUnverified()
  }

  const selectBrand = (next: ProviderBrand): void => {
    setBrand(next)
    selectMode(next.modes[0]!)
  }

  const submitForm = handleSubmit(async (values) => {
    await submit(values)
  })

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose()
      }}
    >
      <DialogContent showCloseButton={false} className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add AI provider</DialogTitle>
          <DialogDescription>
            Keys are stored in your OS keychain, never in your graph.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            void submitForm(event)
          }}
        >
          <div role="radiogroup" aria-label="Provider" className="grid grid-cols-4 gap-1.5">
            {PROVIDER_BRANDS.map((candidate) => {
              const selected = candidate.id === brand.id
              return (
                <button
                  key={candidate.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={candidate.name}
                  onClick={() => selectBrand(candidate)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2.5 transition-all duration-150 ease-swift',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                    selected
                      ? 'border-accent bg-accent-soft/40 text-text'
                      : 'border-border text-text-secondary hover:border-border-strong hover:text-text',
                  )}
                >
                  <ProviderLogo brand={candidate} />
                  <span className="text-[11px] font-medium">{candidate.name}</span>
                </button>
              )
            })}
          </div>

          {brand.modes.length > 1 ? (
            <div className="flex flex-col gap-1">
              <span className={FIELD_LABEL_CLASS}>Connection</span>
              <div
                role="radiogroup"
                aria-label="Connection"
                className="flex gap-0.5 rounded-lg bg-surface-hover p-0.5"
              >
                {brand.modes.map((candidate) => {
                  const selected = candidate.provider === providerId
                  return (
                    <button
                      key={candidate.provider}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => selectMode(candidate)}
                      className={cn(
                        'flex h-7 flex-1 items-center justify-center rounded-md text-xs font-medium transition-all duration-150 ease-swift',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                        selected
                          ? 'bg-surface text-text shadow-sm'
                          : 'text-text-muted hover:text-text',
                      )}
                    >
                      {candidate.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
          <p className="text-xs text-text-muted">{mode.description}</p>

          {isOpenAICompatible ? (
            <>
              <label className="flex flex-col gap-1">
                <span className={FIELD_LABEL_CLASS}>Endpoint base URL</span>
                <Input
                  type="url"
                  placeholder={DEFAULT_OPENAI_COMPATIBLE_BASE_URL}
                  autoComplete="off"
                  spellCheck={false}
                  {...register('baseUrl', {
                    validate: (value) => isHttpBaseUrl(value) || 'Enter an http(s) endpoint URL.',
                    onChange: () => {
                      resetUnverified()
                    },
                  })}
                />
                {formState.errors.baseUrl ? (
                  <span role="alert" className="text-xs text-red-600 dark:text-red-400">
                    {formState.errors.baseUrl.message}
                  </span>
                ) : null}
                {isPlainHttpRemoteBaseUrl(baseUrlValue) ? (
                  <InlineAlert tone="warning">
                    This endpoint uses plain http, so the API key and note content are visible to
                    the network in transit.
                  </InlineAlert>
                ) : null}
              </label>
              <label className="flex flex-col gap-1">
                <span className={FIELD_LABEL_CLASS}>Model id</span>
                <Input
                  aria-label="Model id"
                  autoComplete="off"
                  spellCheck={false}
                  {...register('model', {
                    validate: (value) => value.trim().length > 0 || 'Enter a model id.',
                    onChange: () => {
                      resetUnverified()
                    },
                  })}
                />
                {formState.errors.model ? (
                  <span role="alert" className="text-xs text-red-600 dark:text-red-400">
                    {formState.errors.model.message}
                  </span>
                ) : null}
              </label>
            </>
          ) : null}

          {isCliProvider ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-text-muted">
                No API key — install the{' '}
                <code>{CLI_BINARIES[provider.id]?.binary ?? provider.id}</code> CLI and sign in once
                {CLI_BINARIES[provider.id]?.hint ?? ''}. The model is picked in the chat.
              </p>
              {provider.id === 'codex-cli' ? <CodexSignIn /> : null}
            </div>
          ) : (
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL_CLASS}>
                {apiKeyRequired ? 'API key' : 'API key (optional)'}
              </span>
              <Input
                type="password"
                placeholder={provider.keyPlaceholder}
                autoComplete="off"
                spellCheck={false}
                {...register('apiKey', {
                  validate: (value) =>
                    !apiKeyRequired || value.trim().length > 0 || 'Enter an API key.',
                  onChange: () => {
                    resetUnverified()
                  },
                })}
              />
              {formState.errors.apiKey ? (
                <span role="alert" className="text-xs text-red-600 dark:text-red-400">
                  {formState.errors.apiKey.message}
                </span>
              ) : null}
            </label>
          )}

          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-accent" {...register('isDefault')} />
            <span className="text-sm text-text">Use as the default provider</span>
          </label>

          {submitError !== null ? <InlineAlert tone="error">{submitError}</InlineAlert> : null}
          {unverified ? (
            <InlineAlert tone="warning">
              Couldn't reach {provider.label} to verify the key. Submit again to save it unverified.
            </InlineAlert>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={formState.isSubmitting}>
              {unverified ? 'Save anyway' : 'Add provider'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
