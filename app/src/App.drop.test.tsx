import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import App from './App'
import { useEditorStore } from './store'

/** Each drop carries its own bases: the same sequence twice is shown, not opened again. */
let drops = 0
function dropFasta(target: Element) {
  const bases = 'ACGT'.repeat(4) + 'ACGT'.slice(0, ++drops % 4) + 'G'.repeat(drops)
  const file = new File([`>dropped\n${bases}\n`], 'dropped.fasta', { type: 'text/plain' })
  fireEvent.drop(target, { dataTransfer: { files: [file], types: ['Files'] } })
}

const dropped = () => useEditorStore.getState().tabs.filter(t => t.doc.name === 'dropped')

describe('dropping files', () => {
  it('imports what is pasted with focus in the explorer', async () => {
    render(<App />)
    const explorer = document.querySelector('.explorer-sidebar')!
    fireEvent.paste(explorer, { clipboardData: { getData: () => '>pastedHere\nACGTACGTTT\n' } })
    await waitFor(() => expect(useEditorStore.getState().tabs.some(t => t.doc.name === 'pastedHere')).toBe(true))
  })

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

  it('takes a BAM dropped on the editor, which it used to turn away as unsupported', async () => {
    render(<App />)
    const bam = new File(['x'], 'mapped.bam')
    fireEvent.drop(document.querySelector('.app-root')!, { dataTransfer: { files: [bam], types: ['Files'] } })
    expect(document.querySelector('.drop-error')).toBeNull()
    // Its dialog loads lazily, which can take over a second while the other
    // App suites run alongside.
    expect(await screen.findByText(/mapped\.bam/, undefined, { timeout: 5000 })).toBeTruthy()
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
