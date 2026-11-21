import { useState, type ReactElement } from 'react'
import {
  buildCustomInstructions,
  buildImportMemoriesPrompt,
  CHATGPT_INSTRUCTIONS_MAX_CHARS,
  type AgentInstructionPlatform,
} from '@kore/core'
import { CopyButton } from '@/components/settings/copy-button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export type MemoryPromptTab = 'import' | 'instructions'

export interface MemoryPromptsDialogProps {
  open: boolean
  tab: MemoryPromptTab
  onTabChange: (tab: MemoryPromptTab) => void
  onOpenChange: (open: boolean) => void
  vaultName: string
  systemPath: string
}

/**
 * Copyable onboarding prompts for external agents (ChatGPT, Claude, Cursor,
 * Grok): a one-click memory import prompt and platform-sized Custom
 * Instructions backed by the vault's cyber-brain contract.
 */
export function MemoryPromptsDialog({
  open,
  tab,
  onTabChange,
  onOpenChange,
  vaultName,
  systemPath,
}: MemoryPromptsDialogProps): ReactElement {
  const [platform, setPlatform] = useState<AgentInstructionPlatform>('chatgpt')
  const [error, setError] = useState<string | null>(null)

  const importPrompt = buildImportMemoriesPrompt({ vaultName, systemPath })
  const instructions = buildCustomInstructions(platform, { vaultName, systemPath })
  const activeText = tab === 'import' ? importPrompt : instructions

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[34rem]">
        <DialogHeader>
          <DialogTitle>
            {tab === 'import' ? 'Import memories from another AI' : 'Agent custom instructions'}
          </DialogTitle>
          <DialogDescription>
            {tab === 'import'
              ? 'Paste this into ChatGPT, Claude, or another assistant connected to your vault to migrate its stored memories verbatim with original dates.'
              : 'Paste these instructions into your AI client so every new chat checks your vault, saves durable memories, and honors exclusions.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1 border-b border-border pb-2">
          <TabButton active={tab === 'import'} onClick={() => onTabChange('import')}>
            Import prompt
          </TabButton>
          <TabButton active={tab === 'instructions'} onClick={() => onTabChange('instructions')}>
            Custom instructions
          </TabButton>
        </div>

        {tab === 'instructions' ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1">
              <TabButton
                active={platform === 'chatgpt'}
                onClick={() => setPlatform('chatgpt')}
                compact
              >
                ChatGPT
              </TabButton>
              <TabButton
                active={platform === 'claude'}
                onClick={() => setPlatform('claude')}
                compact
              >
                Claude / Cursor / Grok
              </TabButton>
            </div>
            {platform === 'chatgpt' ? (
              <Badge variant="secondary" className="tabular-nums">
                {instructions.length} / {CHATGPT_INSTRUCTIONS_MAX_CHARS} chars
              </Badge>
            ) : null}
          </div>
        ) : null}

        {tab === 'instructions' ? (
          <p className="text-xs text-text-muted">
            {platform === 'chatgpt'
              ? 'ChatGPT: Settings → Personalization → Custom instructions.'
              : 'Claude: Profile → Settings → Account → Instructions for Claude.'}
          </p>
        ) : null}

        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-sunken p-3 font-mono text-2xs leading-relaxed text-text-secondary select-all">
          {activeText}
        </pre>

        <div className="flex items-center justify-between gap-3">
          {error !== null ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : (
            <span className="text-xs text-text-muted">
              {tab === 'import'
                ? 'Imported items queue in transit and consolidate on the next dream.'
                : 'Works with Kore MCP and Kore Cloud.'}
            </span>
          )}
          <CopyButton
            key={`${tab}-${platform}`}
            text={activeText}
            label={tab === 'import' ? 'Copy prompt' : 'Copy instructions'}
            variant="default"
            onError={setError}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TabButton({
  active,
  compact = false,
  onClick,
  children,
}: {
  active: boolean
  compact?: boolean
  onClick: () => void
  children: string
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md font-medium transition-colors duration-100',
        compact ? 'px-2 py-1 text-2xs' : 'px-2.5 py-1 text-xs',
        active
          ? 'bg-surface-hover text-text'
          : 'text-text-muted hover:bg-surface-hover/60 hover:text-text-secondary',
      )}
    >
      {children}
    </button>
  )
}
