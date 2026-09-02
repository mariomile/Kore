import { useState, type ComponentType, type ReactElement } from 'react'
import { SettingsNavigator } from './settings/settings-navigator'
import { useVisibleSettingsGroups } from './settings/use-visible-settings-sections'
import type { SettingsGroupId, SettingsSectionId } from './settings/sections'
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

/**
 * The settings screen is a full workspace surface: a stable local sidebar
 * selects one settings group at a time, and the page pane scrolls independently.
 * Every control still applies instantly through the settings provider.
 */
/** The section cards, keyed by the registry ids the navigator also uses. */
const SECTION_COMPONENTS: Record<SettingsSectionId, ComponentType> = {
  appearance: AppearanceSection,
  editor: EditorSection,
  'date-time': DateTimeSection,
  browser: BrowserSection,
  templates: TemplatesSection,
  'all-notes': AllNotesSection,
  tasks: TasksSection,
  search: SearchSection,
  'ai-providers': AiProvidersSection,
  'ai-chat': AiChatSection,
  'ai-prompts': AiPromptsSection,
  'audio-memos': AudioMemosSection,
  mcp: McpSection,
  agents: AgentsSection,
  sync: SyncSection,
  integrations: IntegrationsSection,
  import: ImportSection,
  about: AboutSection,
  destructive: DestructiveSection,
}

export function SettingsScreen(): ReactElement {
  const groups = useVisibleSettingsGroups()
  const [activeGroupId, setActiveGroupId] = useState<SettingsGroupId>('general')
  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? groups[0]

  return (
    <div aria-label="Settings" className="flex h-full min-h-0 overflow-hidden bg-surface-app">
      <aside className="w-48 shrink-0 border-r border-border bg-surface-sunken/60 px-3 py-7">
        <h1 className="px-2 text-base font-semibold text-text">Settings</h1>
        <SettingsNavigator
          groups={groups}
          activeGroupId={activeGroupId}
          onSelectGroup={setActiveGroupId}
          className="mt-6"
        />
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto" aria-live="polite">
        {activeGroup === undefined ? null : (
          <div className="mx-auto w-full max-w-3xl px-8 py-9 lg:px-12">
            <header className="mb-8 border-b border-border pb-5">
              <h2 className="text-xl font-semibold tracking-tight text-text">
                {activeGroup.title}
              </h2>
            </header>
            <div>
              {activeGroup.sections.map((section) => {
                const Section = SECTION_COMPONENTS[section.id]
                return <Section key={section.id} />
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
