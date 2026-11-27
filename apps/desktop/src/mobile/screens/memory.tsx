import { useState, type ReactElement } from 'react'
import { Bot } from '@/components/icons'
import { EpisodeDetail, EpisodeList } from '@/components/memory/memory-episodes'
import { useCyberBrainConfig, useMemoryOverview } from '@/components/memory/use-memory'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { MobileScreenHeader } from '@/mobile/screen-header'
import { useBarHeightVar } from '@/mobile/use-bar-height'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'

/**
 * Memory on iPhone (route kind `memory`, pushed from Settings): the
 * episodes the vault's cyber-brain kit wrote, newest first, and one
 * episode's detail with what it learned and the lines it changed. Undo
 * runs the kit's Node script, which only the Mac has, so the phone shows
 * episodes and leaves undoing them to the Mac.
 */
export function MobileMemory(): ReactElement {
  const { back, canBack, navigate } = useRouter()
  const { scopeRef, barRef } = useBarHeightVar('--mobile-header-height')
  const [selected, setSelected] = useState<string | null>(null)
  const { data: config, isPending } = useCyberBrainConfig()
  const { data: overview } = useMemoryOverview(config)
  const episode = overview?.episodes.find((entry) => entry.path === selected) ?? null

  return (
    <div ref={scopeRef} className="relative flex h-full w-screen flex-col">
      <MobileScreenHeader
        ref={barRef}
        title={episode === null ? 'Memory' : ''}
        accessibleTitle={episode?.title ?? 'Memory'}
        onBack={() =>
          episode !== null ? setSelected(null) : canBack ? back() : navigate({ kind: 'settings' })
        }
      />
      <main
        className="min-h-0 flex-1 overflow-y-auto"
        style={{
          paddingTop: 'var(--mobile-header-height, 0px)',
          paddingBottom: 'var(--mobile-tab-bar-height, env(safe-area-inset-bottom))',
        }}
      >
        {isPending || (config != null && overview === undefined) ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : config == null || overview === undefined ? (
          <EmptyState
            icon={Bot}
            title="Memory isn’t set up in this vault"
            description="What your agents do and learn shows here once the vault’s AGENTS.md sets up a memory contract."
            className="mt-16 px-6"
          />
        ) : episode !== null ? (
          <div className="px-5 pt-2 pb-8">
            <EpisodeDetail
              key={episode.path}
              episode={episode}
              config={config}
              open={(path) => navigate(routeForPath(path))}
              onUndone={() => setSelected(null)}
              canUndo={false}
              phone
            />
            <p className="mt-8 text-[13px] text-text-muted">
              To undo this episode, open Memory in Kore on your Mac.
            </p>
          </div>
        ) : overview.episodes.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="No episodes yet"
            description="Each agent writes one at the end of a working session: what it did, what it learned, and every line it changed."
            className="mt-16 px-6"
          />
        ) : (
          <div className="px-2 pt-2 pb-8">
            <p className="px-3 pb-4 text-[15px] text-text-muted">
              What your agents did and learned.
            </p>
            <EpisodeList
              episodes={overview.episodes}
              selected={null}
              onSelect={setSelected}
              phone
            />
          </div>
        )}
      </main>
    </div>
  )
}
