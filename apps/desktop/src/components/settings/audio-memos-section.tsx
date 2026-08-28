import type { ReactElement } from 'react'
import {
  aiProvider,
  transcriptionModelFor,
  TRANSCRIPTION_MODEL_OPTIONS,
  TRANSCRIPTION_PROVIDERS,
  type TranscriptionProvider,
} from '@reflect/core'
import { useSettings } from '@/providers/settings-provider'
import { SettingsField } from './field'
import { ModelCombobox } from './model-combobox'
import { SettingsSection } from './section'
import { SettingsSwitchField } from './switch-field'

/** Preferences for recording enrichment after the raw audio is safely stored. */
export function AudioMemosSection(): ReactElement {
  const { settings, updateSettings } = useSettings()
  // Only providers with a key configured here can transcribe, so only those
  // get a model row — an empty section would read as a broken setting.
  const configured = TRANSCRIPTION_PROVIDERS.filter((provider) =>
    settings.aiProviders.some((entry) => entry.provider === provider),
  )

  const setModel = (provider: TranscriptionProvider, model: string): void => {
    updateSettings({
      transcriptionModels: { ...settings.transcriptionModels, [provider]: model },
    })
  }

  return (
    <SettingsSection id="audio-memos">
      <SettingsSwitchField
        legend="Transcription auto-format"
        description="Use AI to add punctuation, paragraphs, and light Markdown while preserving the original meaning."
        checked={settings.transcriptionFormat}
        onCheckedChange={(transcriptionFormat) => updateSettings({ transcriptionFormat })}
      />

      {configured.length === 0 ? (
        <div className="px-4 py-3.5">
          <p className="text-sm font-medium text-text">Transcription model</p>
          <p className="mt-0.5 text-xs text-text-muted">
            Add an OpenAI or Google provider under AI providers to choose the model that transcribes
            your voice notes.
          </p>
        </div>
      ) : (
        configured.map((provider) => (
          <SettingsField
            key={provider}
            legend={`${aiProvider(provider).label} transcription model`}
            description="The speech-to-text model for voice notes. Pick a listed one or type any model id the provider accepts — chat models are a separate choice and never used here."
          >
            <div className="mt-3">
              <ModelCombobox
                value={transcriptionModelFor(settings.transcriptionModels, provider)}
                provider={provider}
                models={TRANSCRIPTION_MODEL_OPTIONS[provider]}
                onChange={(model) => setModel(provider, model)}
                ariaLabel={`${aiProvider(provider).label} transcription model`}
              />
            </div>
          </SettingsField>
        ))
      )}
    </SettingsSection>
  )
}
