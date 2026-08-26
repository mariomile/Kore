import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  displayNoteTitle,
  getNote,
  isUntitledNotePath,
  listChatConversations,
  noteFileStem,
  type OpenTab,
} from '@reflect/core'
import { useBridgeReady } from '@/hooks/use-bridge-ready'
import { CHAT_QUERY_SCOPE, INDEX_QUERY_SCOPE } from '@/lib/query-client'
import { SURFACE_TAB_LABEL } from '@/providers/open-tab'
import { useGraph } from '@/providers/graph-provider'
import { useOpenTabs } from '@/providers/open-tabs-provider'

export interface OpenTabItem {
  tab: OpenTab
  title: string
}

/**
 * Join persisted tab identities with the titles rendered by the strip and the
 * sidebar. Notes resolve through the index, conversations through chat
 * history, and singleton workspace pages use their stable product labels.
 */
export function useOpenTabItems(): OpenTabItem[] {
  const { tabs, activePath, pruneTab } = useOpenTabs()
  const { graph, indexing } = useGraph()
  const bridgeReady = useBridgeReady()
  const notePaths = useMemo(
    () => tabs.flatMap((tab) => (tab.kind === 'note' ? [tab.path] : [])),
    [tabs],
  )
  const hasChatTabs = tabs.some((tab) => tab.kind === 'chat')

  const { data: noteRows, isSuccess: notesResolved } = useQuery({
    queryKey: [INDEX_QUERY_SCOPE, graph?.root, 'open-tab-notes', notePaths],
    queryFn: async () => {
      const found = await Promise.all(notePaths.map((path) => getNote(path)))
      return new Map(notePaths.map((path, index) => [path, found[index] ?? null]))
    },
    enabled: bridgeReady && graph !== null && notePaths.length > 0,
  })

  const { data: conversations } = useQuery({
    queryKey: [CHAT_QUERY_SCOPE, 'conversations', graph?.root],
    queryFn: () => listChatConversations(),
    enabled: bridgeReady && graph !== null && hasChatTabs,
  })

  useEffect(() => {
    if (!notesResolved || noteRows === undefined || indexing) {
      return
    }
    for (const path of notePaths) {
      if (
        noteRows.get(path) === null &&
        path !== activePath &&
        !isUntitledNotePath(path)
      ) {
        pruneTab(path)
      }
    }
  }, [notesResolved, noteRows, indexing, notePaths, activePath, pruneTab])

  return useMemo(() => {
    const chatTitles = new Map(
      conversations?.map((conversation) => [conversation.id, conversation.title]) ?? [],
    )
    return tabs.map((tab): OpenTabItem => {
      switch (tab.kind) {
        case 'note':
          return {
            tab,
            title: isUntitledNotePath(tab.path)
              ? 'Untitled'
              : displayNoteTitle(noteRows?.get(tab.path)?.title ?? noteFileStem(tab.path)),
          }
        case 'chat':
          return { tab, title: chatTitles.get(tab.conversationId) ?? 'New chat' }
        case 'surface':
          return { tab, title: SURFACE_TAB_LABEL[tab.surface] }
      }
    })
  }, [tabs, noteRows, conversations])
}
