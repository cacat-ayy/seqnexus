import { Component, type ErrorInfo, type ReactNode } from 'react'
import './ErrorBoundary.css'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  componentStack: string | null
  copied: boolean
}

/**
 * Catches render errors anywhere below it so a single component fault cannot
 * blank the whole editor.
 *
 * The session auto-saves to localStorage + IndexedDB independently of React
 * state, so a crash here does not take the user's work with it — reloading
 * restores the last saved session. The fallback says so explicitly, because
 * the natural assumption on seeing a crash screen is that the work is gone.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null, copied: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null })
    console.error('Unhandled render error:', error, info.componentStack)
  }

  private details(): string {
    const { error, componentStack } = this.state
    return [
      `Error: ${error?.message ?? 'unknown'}`,
      `User agent: ${navigator.userAgent}`,
      '',
      error?.stack ?? '(no stack)',
      '',
      'Component stack:',
      componentStack ?? '(unavailable)',
    ].join('\n')
  }

  private copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(this.details())
      this.setState({ copied: true })
      window.setTimeout(() => this.setState({ copied: false }), 2000)
    } catch {
      // Clipboard blocked (permissions, insecure context) — the details are
      // shown on screen anyway, so the user can still select and copy them.
    }
  }

  render() {
    const { error, copied } = this.state
    if (!error) return this.props.children

    return (
      <div className="eb-root" role="alert">
        <div className="eb-panel">
          <h1 className="eb-title">Something went wrong</h1>
          <p className="eb-lede">
            The editor hit an unexpected error and stopped rendering.{' '}
            <strong>Your work is not lost</strong> — the session is saved automatically,
            so reloading should bring back your sequences as of the last save.
          </p>

          <p className="eb-message">{error.message}</p>

          <div className="eb-actions">
            <button className="eb-btn eb-btn-primary" onClick={() => window.location.reload()}>
              Reload editor
            </button>
            <button className="eb-btn" onClick={this.copyDetails}>
              {copied ? 'Copied' : 'Copy error details'}
            </button>
          </div>

          <details className="eb-details">
            <summary>Technical details</summary>
            <pre>{this.details()}</pre>
          </details>

          <p className="eb-footnote">
            If reloading brings the error straight back, a saved document may be
            triggering it. Opening the app in a private window starts a clean
            session without touching your saved one.
          </p>
        </div>
      </div>
    )
  }
}
