import { aiProvider, type AiProviderConfig, type ChatModelOption } from '@reflect/core'

/** One configured provider's models, shaped for a picker. */
export interface ModelOptionGroup {
  configId: string
  /** Provider label, key-hint-qualified when the provider is configured twice. */
  label: string
  /** The group's models, each with its picker value (index into the options). */
  options: Array<{ option: ChatModelOption; value: string }>
}

function providerQualifier(provider: AiProviderConfig): string {
  if (provider.provider === 'openai-compatible') {
    return provider.baseUrl
  }
  return provider.keyHint === '' ? '' : `·····${provider.keyHint}`
}

/**
 * The flat option list regrouped per configured provider for rendering
 * (options arrive consecutively per entry). Values are list indexes — model
 * ids alone can collide across providers. Shared by desktop's composer
 * `Select` and the mobile model sheet.
 */
export function groupModelOptions(
  options: ChatModelOption[],
  providers: AiProviderConfig[],
): ModelOptionGroup[] {
  const groups: ModelOptionGroup[] = []
  for (const [index, option] of options.entries()) {
    const item = { option, value: String(index) }
    const last = groups.at(-1)
    if (last?.configId === option.configId) {
      last.options.push(item)
      continue
    }
    const providerLabel = aiProvider(option.provider).label
    const duplicated =
      providers.filter((provider) => provider.provider === option.provider).length > 1
    const configured = providers.find((provider) => provider.id === option.configId) ?? null
    const qualifier = configured === null ? '' : providerQualifier(configured)
    groups.push({
      configId: option.configId,
      label: duplicated && qualifier !== '' ? `${providerLabel} · ${qualifier}` : providerLabel,
      options: [item],
    })
  }
  return groups
}

/**
 * The model name alone, for the composer's picker trigger: a provider-model
 * label ("Anthropic · Claude Sonnet 4.5", "openai/gpt-5") carries the provider
 * twice once the grouped list already names it, and the composer is where the
 * least type belongs. Falls back to the label untouched when there is nothing
 * to strip.
 */
export function shortModelLabel(label: string): string {
  const separated = label.split(/\s·\s|\s—\s/).at(-1) ?? label
  const trimmed = separated.trim()
  const slashed = trimmed.includes('/') ? (trimmed.split('/').at(-1) ?? trimmed) : trimmed
  return slashed.trim() === '' ? label : slashed.trim()
}
