import type { ReactElement } from 'react'
import { useSettings } from '@/providers/settings-provider'
import { SettingsSection } from './section'
import { SettingsSwitchField } from './switch-field'

/**
 * Whether pasting into a note also saves what was pasted as a card in its
 * collection (Links, Images, PDFs, Files). Every kind starts off, so a paste
 * is just a paste until the user opts in. Saving on purpose (share sheet,
 * browser extension, `kore capture`) is not affected, and cards that already
 * exist stay where they are.
 */
export function PastedResourcesSection(): ReactElement {
  const { settings, updateSettings } = useSettings()

  return (
    <SettingsSection id="pasted-resources">
      <SettingsSwitchField
        legend="Save pasted links"
        description="A pasted web link also gets its own card in the Links collection, with every note it was pasted in."
        checked={settings.pasteCollectLinks}
        onCheckedChange={(pasteCollectLinks) => updateSettings({ pasteCollectLinks })}
      />
      {settings.pasteCollectLinks ? (
        <SettingsSwitchField
          legend="Keep the page text"
          description="Saved link cards also keep the article's text or the video's transcript. Never for private notes."
          checked={settings.pasteSaveLinkText}
          onCheckedChange={(pasteSaveLinkText) => updateSettings({ pasteSaveLinkText })}
        />
      ) : null}
      <SettingsSwitchField
        legend="Save pasted images"
        description="A pasted or dropped image also gets a card in the Images collection."
        checked={settings.pasteCollectImages}
        onCheckedChange={(pasteCollectImages) => updateSettings({ pasteCollectImages })}
      />
      <SettingsSwitchField
        legend="Save pasted PDFs"
        description="A pasted or dropped PDF also gets a card in the PDFs collection."
        checked={settings.pasteCollectPdfs}
        onCheckedChange={(pasteCollectPdfs) => updateSettings({ pasteCollectPdfs })}
      />
      <SettingsSwitchField
        legend="Save other pasted files"
        description="Any other pasted or dropped file also gets a card in the Files collection."
        checked={settings.pasteCollectFiles}
        onCheckedChange={(pasteCollectFiles) => updateSettings({ pasteCollectFiles })}
      />
    </SettingsSection>
  )
}
