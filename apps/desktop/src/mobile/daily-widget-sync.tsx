import { useEffect, type ReactElement } from 'react'
import {
  dailyPath,
  readDailyWidgetSnapshot,
  subscribeFileChanges,
  updateDailyWidget,
  type GraphInfo,
} from '@kore/core'
import { isNativeShell } from '@/lib/platform'
import { useToday } from '@/lib/use-today'

/** Coalesces a typing burst into one widget refresh. */
const REFRESH_DEBOUNCE_MS = 1500

/**
 * Keep the iOS daily-note widget's digest current: on launch, on every
 * return to the foreground, at the day change, and after edits to today's
 * note. Only a changed digest reaches the native side, so WidgetKit's reload
 * budget is spent on real changes and an idle app costs nothing.
 */
export interface DailyWidgetSyncProps {
  graph: GraphInfo
}

/** Renders nothing; mounted once per open graph beside the mobile shell. */
export function DailyWidgetSync({ graph }: DailyWidgetSyncProps): ReactElement | null {
  const today = useToday()

  useEffect(() => {
    if (!isNativeShell()) {
      return
    }
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastPushed: string | null = null
    const todayPath = dailyPath(today)

    const refresh = async (): Promise<void> => {
      try {
        const json = JSON.stringify(await readDailyWidgetSnapshot(today, graph.generation))
        if (disposed || json === lastPushed) {
          return
        }
        await updateDailyWidget(json)
        lastPushed = json
      } catch (cause) {
        console.warn('refreshing the daily widget failed:', cause)
      }
    }
    const schedule = (): void => {
      if (timer !== null) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => {
        timer = null
        void refresh()
      }, REFRESH_DEBOUNCE_MS)
    }
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        schedule()
      }
    }

    void refresh()
    document.addEventListener('visibilitychange', onVisible)
    let unsubscribe: (() => void) | null = null
    void subscribeFileChanges((changes) => {
      if (changes.some((change) => change.path === todayPath)) {
        schedule()
      }
    })
      .then((stop) => {
        if (disposed) {
          stop()
        } else {
          unsubscribe = stop
        }
      })
      .catch((cause: unknown) => {
        console.warn('daily widget file-change subscription failed:', cause)
      })

    return () => {
      disposed = true
      if (timer !== null) {
        clearTimeout(timer)
      }
      document.removeEventListener('visibilitychange', onVisible)
      unsubscribe?.()
    }
  }, [graph.generation, today])
  return null
}
