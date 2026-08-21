import type { ReactElement } from 'react'
import { siClaude, siGooglegemini, siOpenrouter } from 'simple-icons'
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
const OPENAI_PATH =
  'M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z'

/** One way to connect a brand, mapped to a stored provider id. */
export interface ProviderConnectionMode {
  provider: AiProviderId
  /** The segmented-control label: "Subscription" / "API key" / "Endpoint". */
  label: string
  /** One line under the switcher explaining what this mode uses. */
  description: string
}

export interface ProviderBrand {
  id: string
  name: string
  /** 24×24 SVG path drawn with currentColor; null renders the generic plug. */
  path: string | null
  modes: ProviderConnectionMode[]
}

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

/** The brand a stored provider entry belongs to (for logos on rows). */
export function brandForProvider(provider: AiProviderId): ProviderBrand | undefined {
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
    return <Plug aria-hidden strokeWidth={1.75} className={cn('size-5', className)} />
  }
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={cn('size-5', className)}>
      <path d={brand.path} />
    </svg>
  )
}
