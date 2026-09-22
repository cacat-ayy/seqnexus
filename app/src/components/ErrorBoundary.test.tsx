import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

function Boom(): never {
  throw new Error('kaboom in render')
}

describe('ErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>editor content</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('editor content')).toBeInTheDocument()
  })

  it('catches a render error instead of unmounting the tree', () => {
    // React logs caught errors to console.error; silence it for this test.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('kaboom in render')).toBeInTheDocument()
  })

  it('tells the user their work is saved and offers a reload', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )

    // The reassurance is the point of the fallback: a crash screen otherwise
    // reads as "your unsaved work is gone".
    expect(screen.getByText(/your work is not lost/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload editor/i })).toBeInTheDocument()
  })
})
