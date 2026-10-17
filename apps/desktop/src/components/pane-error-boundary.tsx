import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react'
import { logWebview } from '@reflect/core'
import { PaneErrorCard } from '@/components/pane-error-card'

interface PaneErrorBoundaryProps {
  /**
   * Identity of what the pane shows. A new key (the pane navigated) clears a
   * caught error, so the next note gets a fresh render rather than the card.
   */
  resetKey: string
  /** What the pane is (a route kind, `preview`), for the log line. */
  surface: string
  /** Graph-relative file behind the pane, when it shows one. */
  path: string | null
  /**
   * What to show instead of the default {@link PaneErrorCard}, for surfaces
   * too small to hold it (an inline preview).
   */
  fallback?: ReactNode
  children: ReactNode
}

interface PaneErrorBoundaryState {
  error: Error | null
  resetKey: string
  /** Bumped by "Reload pane" to remount the subtree from scratch. */
  attempt: number
}

/**
 * Contains a render crash to the one pane it happened in. Without it a single
 * note React cannot draw (a malformed embed, a host capability missing in
 * dev) unmounts the whole workspace into a white window; with it the sidebar,
 * the tab strip and every other pane keep working and the broken one shows a
 * recoverable card. The crash goes to the local log with the file it hit.
 */
export class PaneErrorBoundary extends Component<PaneErrorBoundaryProps, PaneErrorBoundaryState> {
  override state: PaneErrorBoundaryState = {
    error: null,
    resetKey: this.props.resetKey,
    attempt: 0,
  }

  static getDerivedStateFromError(error: unknown): Partial<PaneErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  static getDerivedStateFromProps(
    props: PaneErrorBoundaryProps,
    state: PaneErrorBoundaryState,
  ): Partial<PaneErrorBoundaryState> | null {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const where = this.props.path ?? this.props.surface
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
    logWebview('error', `pane crashed (${where}): ${detail}${info.componentStack ?? ''}`).catch(
      () => {},
    )
  }

  private readonly reload = (): void => {
    this.setState((state) => ({ error: null, attempt: state.attempt + 1 }))
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback
      }
      return (
        <PaneErrorCard error={this.state.error} path={this.props.path} onReload={this.reload} />
      )
    }
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
  }
}
