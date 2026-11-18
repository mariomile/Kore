import { useEffect, useRef, useState, type ReactElement } from 'react'
import { isUntitledNotePath } from '@kore/core'
import { NoteChildrenPanel } from '@/components/note-children-panel'
import { NotePane } from '@/components/note-pane'
import { NoteOutlineRail } from '@/components/notes/note-outline-rail'
import { hapticImpactLight } from '@/mobile/haptics'
import { IncomingBacklinks } from '@/mobile/incoming-backlinks'
import { MOBILE_CONTENT_GUTTER } from '@/mobile/mobile-content-gutter'
import { MobileScreenHeader } from '@/mobile/screen-header'
import { useBarHeightVar } from '@/mobile/use-bar-height'
import { NoteActionsMenu } from '@/mobile/note-actions-menu'
import { cn } from '@/lib/utils'
import { setTabBarScrolledAway } from '@/mobile/chrome-visibility'
import { useRouter } from '@/routing/router'

/**
 * One note, opened from a wiki link, the new-note button, or (later) search
 * (Plan 19). Lazy like the desktop note route, so a link to a not-yet-created
 * note opens an empty editor and the file is born on the first keystroke; a
 * fresh untitled note (`+`, V1 parity) autofocuses so the keyboard is up and
 * typing names it via the ghost-title flow. That is the only arrival that
 * focuses: navigating here (wiki link, backlink, All list, back) never raises
 * the keyboard — a focus during the stack animation would pull the keyboard
 * up mid-slide. Back pops the history stack; a cold entry (nothing to pop)
 * lands on today instead.
 */
export function MobileNote({ path }: { path: string }): ReactElement {
  const { back, canBack, navigate } = useRouter()
  const { scopeRef, barRef } = useBarHeightVar('--mobile-header-height')
  const untitled = isUntitledNotePath(path)
  const mainRef = useRef<HTMLElement>(null)
  const [titleInBar, setTitleInBar] = useState(false)
  const [barTitle, setBarTitle] = useState('')

  // iPhone design pass (2026-11): the note's own title is the
  // page heading, so the bar stays empty until it scrolls away and then shows
  // it small (the iOS large-title pattern); scrolling down hides the tab bar,
  // scrolling up brings it back. One passive listener, coalesced per frame.
  useEffect(() => {
    const main = mainRef.current
    if (main === null) return
    let lastTop = main.scrollTop
    let frame = 0
    const onScroll = (): void => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const top = main.scrollTop
        const showTitle = top > 56
        if (showTitle) {
          // The note's own H1 (what the page shows), else the file name.
          const heading = main.querySelector('.ProseMirror h1')?.textContent?.trim()
          setBarTitle(
            untitled ? '' : heading || (path.split('/').pop() ?? '').replace(/\.md$/i, ''),
          )
        }
        setTitleInBar(showTitle)
        if (top < 24) setTabBarScrolledAway(false)
        else if (top - lastTop > 6) setTabBarScrolledAway(true)
        else if (lastTop - top > 6) setTabBarScrolledAway(false)
        lastTop = top
      })
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      main.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
      setTabBarScrolledAway(false)
    }
  }, [path, untitled])

  return (
    <div ref={scopeRef} className="relative flex h-full w-screen flex-col">
      <MobileScreenHeader
        ref={barRef}
        title={titleInBar ? barTitle : ''}
        accessibleTitle={untitled ? 'New note' : 'Edit note'}
        onBack={() => (canBack ? back() : navigate({ kind: 'today' }))}
        trailing={
          <NoteActionsMenu
            path={path}
            onDeleted={() => (canBack ? back() : navigate({ kind: 'today' }))}
          />
        }
      />
      <main
        ref={mainRef}
        className="min-h-0 flex-1 overflow-y-auto"
        // The chrome floats: the scroller runs the full screen and pads past
        // the glass header and tab bar, so content scrolls under both.
        // Keyboard avoidance is the shell root's job (it ends at the
        // keyboard's top); the bottom fallback only clears the home
        // indicator while the tab bar is hidden.
        style={{
          paddingTop: 'var(--mobile-header-height, 0px)',
          paddingBottom: 'var(--mobile-tab-bar-height, env(safe-area-inset-bottom))',
          // An outline jump parks its heading just under the glass header.
          ['--kore-outline-scroll-margin' as string]:
            'calc(var(--mobile-header-height, 0px) + 0.75rem)',
        }}
      >
        <NotePane
          path={path}
          lazy
          autoFocus={untitled}
          showBacklinks={false}
          // The daily surface gets its top inset from the date header; a
          // plain note has no chrome between the header bar and the body,
          // so the pane carries the vertical breathing room itself.
          className="pt-4"
          gutterClassName={MOBILE_CONTENT_GUTTER}
          editorClassName="min-h-[30dvh]"
        />
        {/* The mobile section (touch chrome) replaces NotePane's built-in
            desktop panel; a daily-note backlink opens the Daily surface at
            that date rather than pushing another note screen. */}
        <NoteChildrenPanel key={path} path={path} className={MOBILE_CONTENT_GUTTER} />
        <IncomingBacklinks path={path} className={cn(MOBILE_CONTENT_GUTTER, 'pb-4')} />
      </main>
      {/* The Mac's outline, sized for the phone's margin: a tap opens the
          jump list, and it steps aside while the keyboard is up. */}
      <NoteOutlineRail scope={mainRef} className="right-0" onOpen={hapticImpactLight} />
    </div>
  )
}
