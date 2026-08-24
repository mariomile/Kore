import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  ptyClose,
  ptyOpen,
  ptyResize,
  ptyWrite,
  subscribePtyData,
  subscribePtyExit,
} from '@reflect/core'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { isMobileSurface } from '@/lib/platform-surface'
import { cn } from '@/lib/utils'

/**
 * In-app terminal. Ghostty itself cannot run inside the Tauri webview, so
 * this is a local PTY rendered with xterm.js, themed after Ghostty's default
 * palette. The PTY stays alive across route unmounts so leaving and coming
 * back does not kill the shell.
 */

interface LiveSession {
  id: string
  terminal: Terminal
  fit: FitAddon
}

let live: LiveSession | null = null
let opening: Promise<LiveSession> | null = null

const GHOSTTY_THEME = {
  background: '#1d1f21',
  foreground: '#c5c8c6',
  cursor: '#c5c8c6',
  cursorAccent: '#1d1f21',
  selectionBackground: '#373b41',
  black: '#1d1f21',
  red: '#cc6666',
  green: '#b5bd68',
  yellow: '#f0c674',
  blue: '#81a2be',
  magenta: '#b294bb',
  cyan: '#8abeb7',
  white: '#c5c8c6',
  brightBlack: '#969896',
  brightRed: '#cc6666',
  brightGreen: '#b5bd68',
  brightYellow: '#f0c674',
  brightBlue: '#81a2be',
  brightMagenta: '#b294bb',
  brightCyan: '#8abeb7',
  brightWhite: '#ffffff',
} as const

async function ensureSession(): Promise<LiveSession> {
  if (live !== null) {
    return live
  }
  if (opening !== null) {
    return await opening
  }
  opening = (async () => {
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      theme: GHOSTTY_THEME,
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    const cols = 80
    const rows = 24
    const opened = await ptyOpen(cols, rows)
    terminal.onData((data) => {
      void ptyWrite(opened.id, data)
    })
    const session: LiveSession = { id: opened.id, terminal, fit }
    live = session
    void subscribePtyData((event) => {
      if (event.id === session.id) {
        session.terminal.write(event.data)
      }
    })
    void subscribePtyExit((event) => {
      if (event.id !== session.id) {
        return
      }
      const code = event.code === null ? '' : String(event.code)
      session.terminal.writeln(`\r\n[process exited${code === '' ? '' : ` with ${code}`}]`)
      if (live?.id === session.id) {
        live = null
      }
    })
    return session
  })()
  try {
    return await opening
  } finally {
    opening = null
  }
}

/**
 * Full-pane terminal. Desktop-only; mobile (and the browser harness, which
 * has no PTY) show an honest error instead of a fake prompt.
 */
export function TerminalScreen(): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(
    isMobileSurface() ? 'The terminal is available on desktop.' : null,
  )

  useEffect(() => {
    if (isMobileSurface()) {
      return
    }
    const host = hostRef.current
    if (host === null) {
      return
    }
    let cancelled = false
    let resizeObserver: ResizeObserver | null = null
    void ensureSession()
      .then((session) => {
        if (cancelled || hostRef.current === null) {
          return
        }
        const mount = hostRef.current
        if (session.terminal.element) {
          mount.appendChild(session.terminal.element)
        } else {
          session.terminal.open(mount)
        }
        session.fit.fit()
        const dims = session.terminal.cols
        void ptyResize(session.id, dims, session.terminal.rows)
        session.terminal.focus()
        resizeObserver = new ResizeObserver(() => {
          session.fit.fit()
          void ptyResize(session.id, session.terminal.cols, session.terminal.rows)
        })
        resizeObserver.observe(hostRef.current)
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Could not open a terminal.')
        }
      })
    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      // Detach the renderer from this host without killing the PTY — the
      // session is reused the next time this screen mounts.
      const element = live?.terminal.element
      if (element !== undefined && host.contains(element)) {
        host.replaceChildren()
      }
    }
  }, [])

  if (error !== null) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-text-muted">
        {error}
      </div>
    )
  }

  return (
    <div className="h-full bg-[#1d1f21] p-3">
      <div ref={hostRef} className={cn('h-full w-full')} />
    </div>
  )
}

/** Test seam: drop the cached PTY so a later mount starts clean. */
export function resetTerminalSessionForTests(): void {
  if (live !== null) {
    void ptyClose(live.id)
    live.terminal.dispose()
    live = null
  }
  opening = null
}
