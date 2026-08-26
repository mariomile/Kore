import type { ComponentType, ReactElement, ReactNode } from 'react'
import { useVisibleSettingsGroups } from './settings/use-visible-settings-sections'
import {
  settingsGroupTitle,
  type SettingsGroupId,
  type SettingsSectionId,
} from './settings/sections'
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
  // One visibility rule for the page and the navigator: both render from
  // useVisibleSettingsGroups, so a gated section can never appear in one
  // surface and not the other.
  const groups = useVisibleSettingsGroups()
  return (
    <div aria-label="Settings">
      <h1 className="text-lg font-semibold text-text">Settings</h1>
      <div className="mt-6">
        {groups.map((group) => (
          <SettingsGroupBlock key={group.id} id={group.id}>
            {group.sections.map((section) => {
              const Section = SECTION_COMPONENTS[section.id]
              return <Section key={section.id} />
            })}
          </SettingsGroupBlock>
        ))}
      </div>
    </div>
  )
}
