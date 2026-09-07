import { useEffect } from 'react'
import { layoutSlashMenu } from './slash-menu-groups'

let subscriberCount = 0
let bodyObserver: MutationObserver | null = null
let popupObserver: MutationObserver | null = null
let observedPopup: Element | null = null
let layingOut = false

function disconnectPopupObserver(): void {
  popupObserver?.disconnect()
  popupObserver = null
  observedPopup = null
}

function runLayout(popup: Element): void {
  layingOut = true
  layoutSlashMenu(popup)
  layingOut = false
}

function bindSlashMenuPopup(): void {
  const popup = document.querySelector('[data-testid="slash-menu"]')
  if (popup === null) {
    disconnectPopupObserver()
    return
  }
  if (popup !== observedPopup) {
    disconnectPopupObserver()
    observedPopup = popup
    popupObserver = new MutationObserver(() => {
      if (!layingOut && observedPopup !== null) {
        runLayout(observedPopup)
      }
    })
    popupObserver.observe(popup, {
      attributeFilter: ['hidden'],
      attributes: true,
      childList: true,
      subtree: true,
    })
  }
  runLayout(popup)
}

function subscribeSlashMenuLayout(): () => void {
  subscriberCount += 1
  if (bodyObserver === null) {
    bodyObserver = new MutationObserver(bindSlashMenuPopup)
    bodyObserver.observe(document.body, { childList: true, subtree: true })
    bindSlashMenuPopup()
  }
  return () => {
    subscriberCount -= 1
    if (subscriberCount > 0) {
      return
    }
    bodyObserver?.disconnect()
    bodyObserver = null
    disconnectPopupObserver()
  }
}

/**
 * Mounts the Notion-style `/` menu grouping for as long as a note editor is
 * on screen. One document observer is shared across the daily stream.
 */
export function SlashMenuLayout(): null {
  useEffect(() => subscribeSlashMenuLayout(), [])
  return null
}
