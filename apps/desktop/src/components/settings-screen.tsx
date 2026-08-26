import type { ReactElement, ReactNode } from 'react'
import { useShowAdvancedSurfaces } from '@/hooks/use-show-advanced-surfaces'
import { settingsGroupTitle, type SettingsGroupId } from './settings/sections'
import { AboutSection } from './settings/about-section'
import { AgentsSection } from './settings/agents-section'
import { AiChatSection } from './settings/ai-chat-section'
import { AiPromptsSection } from './settings/ai-prompts-section'
import { AiProvidersSection } from './settings/ai-providers-section'
import { AllNotesSection } from './settings/all-notes-section'
import { AppearanceSection } from './settings/appearance-section'
import { AudioMemosSection } from './settings/audio-memos-section'
import { BrowserSection } from './settings/browser-section'
import { DateTimeSection } from './settings/date-time-section'
import { DestructiveSection } from './settings/destructive-section'
import { EditorSection } from './settings/editor-section'
import { ImportSection } from './settings/import-section'
import { IntegrationsSection } from './settings/integrations-section'
import { McpSection } from './settings/mcp-section'
import { SearchSection } from './settings/search-section'
import { SyncSection } from './settings/sync-section'
import { TasksSection } from './settings/tasks-section'
import { TemplatesSection } from './settings/templates-section'

/** A labelled page segment: the registry group's name over its section cards. */
function SettingsGroupBlock({
  id,
  children,
}: {
  id: SettingsGroupId
  children: ReactNode
}): ReactElement {
  return (
    <div className="mt-12 first:mt-0">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
        {settingsGroupTitle(id)}
      </p>
      <div className="mt-3">{children}</div>
    </div>
  )
}

/**
 * The settings screen (a routed view, like notes — reached via ⌘, or the
 * palette's "Open settings"). Sections render in the grouped order of the
 * sections registry, each group under a small caps label; the sticky
 * navigator mirrors the same structure. Every control applies instantly
 * through the settings provider; there is no save button.
 */
export function SettingsScreen(): ReactElement {
  const showAdvanced = useShowAdvancedSurfaces()
  return (
    <div aria-label="Settings">
      <h1 className="text-lg font-semibold text-text">Settings</h1>
      <div className="mt-6">
        <SettingsGroupBlock id="general">
          <AppearanceSection />
          <EditorSection />
          <DateTimeSection />
          <BrowserSection />
        </SettingsGroupBlock>
        <SettingsGroupBlock id="notes">
          <TemplatesSection />
          <AllNotesSection />
          <TasksSection />
          {showAdvanced ? <SearchSection /> : null}
        </SettingsGroupBlock>
        <SettingsGroupBlock id="ai">
          <AiProvidersSection />
          <AiChatSection />
          <AiPromptsSection />
          <AudioMemosSection />
          <McpSection />
          {showAdvanced ? <AgentsSection /> : null}
        </SettingsGroupBlock>
        <SettingsGroupBlock id="data">
          <SyncSection />
          <IntegrationsSection />
          <ImportSection />
        </SettingsGroupBlock>
        <SettingsGroupBlock id="app">
          <AboutSection />
          <DestructiveSection />
        </SettingsGroupBlock>
      </div>
    </div>
  )
}
