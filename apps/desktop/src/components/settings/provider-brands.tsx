import type { ReactElement } from 'react'
import { siClaude, siCursor, siGooglegemini, siOpenrouter } from 'simple-icons'
import { Plug } from 'lucide-react'
import type { AiProviderId } from '@reflect/core'
import { cn } from '@/lib/utils'

/**
 * The provider surface, organized the way people think about it: first the
 * brand (Claude, OpenAI, …), then how to connect to it (subscription through
 * its coding CLI, or an API key). Each mode maps onto one of the flat
 * provider ids the settings document already stores, so this is a pure UI
 * regrouping — nothing persisted changes shape.
 */

// The OpenAI mark, from LobeHub's MIT-licensed icon set (simple-icons no
// longer carries it). 24×24 viewBox, drawn with currentColor like the rest.
// The Grok mark, from LobeHub's MIT-licensed icon set (simple-icons carries
// neither Grok nor xAI). 24×24 viewBox, drawn with currentColor.
const GROK_PATH =
  'M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815'

const OPENAI_PATH =
  'M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z'

/** One way to connect a brand, mapped to a stored provider id. */
export interface ProviderConnectionMode {
  provider: AiProviderId
  /** The segmented-control label: "Subscription" / "API key" / "Endpoint". */
  label: string
  /** One line under the switcher explaining what this mode uses. */
  description: string
  /**
   * Form values this mode starts from when the stored id alone doesn't say
   * enough — the Grok brand rides the OpenAI-compatible machinery with the
   * xAI endpoint pre-filled.
   */
  seed?: { baseUrl: string; model: string } | undefined
}

export interface ProviderBrand {
  id: string
  name: string
  /** 24×24 SVG path drawn with currentColor; null renders the generic plug. */
  path: string | null
  modes: ProviderConnectionMode[]
}

/** The xAI endpoint the Grok brand pre-fills (and is recognized by). */
export const XAI_BASE_URL = 'https://api.x.ai/v1'

export const PROVIDER_BRANDS: ProviderBrand[] = [
  {
    id: 'claude',
    name: 'Claude',
    path: siClaude.path,
    modes: [
      {
        provider: 'claude-cli',
        label: 'Subscription',
        description: 'Runs through the installed Claude Code CLI and bills your Claude plan.',
      },
      {
        provider: 'anthropic',
        label: 'API key',
        description: 'Calls the Anthropic API directly with your key.',
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    path: OPENAI_PATH,
    modes: [
      {
        provider: 'codex-cli',
        label: 'Subscription',
        description: 'Runs through the installed Codex CLI and bills your ChatGPT plan.',
      },
      {
        provider: 'openai',
        label: 'API key',
        description: 'Calls the OpenAI API directly with your key.',
      },
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    path: siGooglegemini.path,
    modes: [
      {
        provider: 'google',
        label: 'API key',
        description: 'Calls the Gemini API with a Google AI Studio key.',
      },
    ],
  },
  {
    id: 'grok',
    name: 'Grok',
    path: GROK_PATH,
    modes: [
      {
        // xAI's API is OpenAI-compatible, so Grok rides the existing custom
        // endpoint machinery with the endpoint pre-filled — key in the OS
        // keychain, models by id. (The community Grok CLI is deliberately
        // not integrated: it auto-approves an unsandboxed shell in headless
        // mode, which the vault's privacy rules cannot fence.)
        provider: 'openai-compatible',
        label: 'API key',
        description: 'Calls the xAI API (api.x.ai) with your key.',
        seed: { baseUrl: XAI_BASE_URL, model: 'grok-4-latest' },
      },
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    path: siCursor.path,
    modes: [
      {
        provider: 'cursor-cli',
        label: 'Subscription',
        description:
          'Runs through the installed Cursor CLI (cursor-agent) and bills your Cursor plan. Read-only: it grounds answers in your notes but never edits them.',
      },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    path: siOpenrouter.path,
    modes: [
      {
        provider: 'openrouter',
        label: 'API key',
        description: 'One key for many models through OpenRouter.',
      },
    ],
  },
  {
    id: 'custom',
    name: 'Custom',
    path: null,
    modes: [
      {
        provider: 'openai-compatible',
        label: 'Endpoint',
        description: 'Any OpenAI-compatible server — local (Ollama, LM Studio) or remote.',
      },
    ],
  },
]

/**
 * The brand a stored provider entry belongs to (for logos on rows). An
 * OpenAI-compatible entry is ambiguous — the Grok brand claims it only when
 * its endpoint is xAI's; anything else is the generic custom endpoint.
 */
export function brandForProvider(
  provider: AiProviderId,
  baseUrl?: string,
): ProviderBrand | undefined {
  if (provider === 'openai-compatible') {
    const isXai = baseUrl !== undefined && baseUrl.includes('api.x.ai')
    return PROVIDER_BRANDS.find((brand) => brand.id === (isXai ? 'grok' : 'custom'))
  }
  return PROVIDER_BRANDS.find((brand) => brand.modes.some((mode) => mode.provider === provider))
}

/** A brand mark: monochrome, riding currentColor so every theme works. */
export function ProviderLogo({
  brand,
  className,
}: {
  brand: ProviderBrand
  className?: string
}): ReactElement {
  if (brand.path === null) {
    return <Plug aria-hidden className={cn('size-5', className)} />
  }
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={cn('size-5', className)}>
      <path d={brand.path} />
    </svg>
  )
}
