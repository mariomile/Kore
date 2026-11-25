import { useEffect, useRef } from 'react'
import { openExternalUrl, preferOsBrowser } from '@/editor/open-external-link'
import { useSettings } from '@/providers/settings-provider'

/**
 * How a card in the editor opens the page it stands for: in the app's
 * browser or the system's, per the setting and the Option key. The returned
 * function is stable, so a ProseMirror plugin built once keeps it, and reads
 * the setting as it is when the card is pressed.
 */
export function useOpenCardLink(): (url: string, event: MouseEvent) => void {
  const openLinksInApp = useSettings().settings.browserOpenLinksInApp
  const openLinksInAppRef = useRef(openLinksInApp)
  useEffect(() => {
    openLinksInAppRef.current = openLinksInApp
  }, [openLinksInApp])
  const open = useRef((url: string, event: MouseEvent): void => {
    openExternalUrl(url, { osBrowser: preferOsBrowser(event.altKey, openLinksInAppRef.current) })
  })
  return open.current
}
