import { fireEvent, render, waitFor } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import App from './App'
import { useEditorStore } from './store'

function dropFasta(target: Element) {
  const file = new File(['>dropped\nACGTACGTACGTACGT\n'], 'dropped.fasta', { type: 'text/plain' })
  fireEvent.drop(target, { dataTransfer: { files: [file], types: ['Files'] } })
}

const dropped = () => useEditorStore.getState().tabs.filter(t => t.doc.name === 'dropped')

describe('dropping files', () => {
  it('opens a file dropped on the explorer once', async () => {
    render(<App />)
    const before = dropped().length
    const explorer = document.querySelector('.explorer-sidebar')
    expect(explorer).toBeTruthy()
    dropFasta(explorer!)
    await waitFor(() => expect(dropped().length).toBe(before + 1))
    // Give a second import time to land, if there were one.
    await new Promise(r => setTimeout(r, 300))
    expect(dropped().length).toBe(before + 1)
  })

  it('opens a file dropped elsewhere once', async () => {
    render(<App />)
    const before = dropped().length
    dropFasta(document.querySelector('.app-root')!)
    await waitFor(() => expect(dropped().length).toBe(before + 1))
    await new Promise(r => setTimeout(r, 300))
    expect(dropped().length).toBe(before + 1)
  })
})
