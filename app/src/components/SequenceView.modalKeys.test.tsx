/**
 * The editor listens for keys on the whole window. With a modal open over it
 * and focus on one of the modal's buttons, Backspace, a base letter or Ctrl+Z
 * used to edit the sequence hidden behind the dialog.
 */
import { render, act, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRef } from 'react'
import SequenceView from './SequenceView'
import { useEditorStore } from '../store'
import { useFocusTrap } from '../hooks/useFocusTrap'

const store = () => useEditorStore.getState()
const bases = () => store().doc.sequence.bases

function Modal() {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)
  return (
    <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
      <button>OK</button>
    </div>
  )
}

function App({ modal }: { modal: boolean }) {
  return (
    <>
      <SequenceView />
      {modal && <Modal />}
    </>
  )
}

beforeEach(() => {
  for (const t of store().tabs) store().closeTab(t.id)
  store().openDocument('pKeys', 'ACGTACGTAC')
  act(() => { store().setSelection({ anchor: 4, caret: 4 }) })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    new Proxy({}, { get: () => () => ({ width: 0 }) }) as unknown as CanvasRenderingContext2D,
  )
})

afterEach(() => { vi.restoreAllMocks() })

describe('keys while a modal is open', () => {
  it('do not edit the sequence behind it, wherever focus is', () => {
    const { getByText } = render(<App modal />)
    const button = getByText('OK')
    button.focus()
    for (const target of [button, document.body]) {
      fireEvent.keyDown(target, { key: 'Backspace' })
      fireEvent.keyDown(target, { key: 'Delete' })
      fireEvent.keyDown(target, { key: 'a' })
      fireEvent.keyDown(target, { key: 'x', ctrlKey: true })
    }
    expect(bases()).toBe('ACGTACGTAC')
    expect(store().canUndo()).toBe(false)
  })

  it('edit again once it closes', () => {
    const { rerender } = render(<App modal />)
    rerender(<App modal={false} />)
    fireEvent.keyDown(document.body, { key: 'g' })
    expect(bases()).toBe('ACGTGACGTAC')
  })
})
