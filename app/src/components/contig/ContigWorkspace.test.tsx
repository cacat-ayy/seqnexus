import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useEditorStore } from '../../store'
import { testContig, testRow } from '../../assembly/testing'
import ContigWorkspace from './ContigWorkspace'

// CCC ATG AAA GCT TGG TAA GGGGGG, with a CDS over the ATG…TAA.
const REF = 'CCCATGAAAGCTTGGTAAGGGGGG'
const store = () => useEditorStore.getState()

function Harness() {
  const c = useEditorStore(s => s.contigs.find(x => x.id === s.activeContigId))
  return c ? <ContigWorkspace key={c.id} contig={c} onClose={() => {}} /> : <div>none</div>
}

function setup() {
  for (const t of store().tabs) store().closeTab(t.id)
  useEditorStore.setState({ contigs: [], activeContigId: null, sequencingReads: [], folders: [] })
  const tabId = store().openDocument('pTest', REF)
  store().addAnnotation({ id: 'cds1', name: 'gfp', type: 'CDS', start: 3, end: 18, strand: 1 })
  // Both reads carry AAA→GAA at reference position 7 (K2E); they cover bases 1–20 only.
  const alt = REF.slice(0, 6) + 'G' + REF.slice(7, 20)
  const doc = testContig([testRow('f', 0, alt), testRow('r', 0, alt, { reversed: true })], REF, 'pTest', tabId)
  store().addContigs([{ name: 'Clone 1', doc }])
  return tabId
}

describe('ContigWorkspace variants and verification', () => {
  beforeEach(() => { localStorage.clear() })

  it('lists variants with their protein change and annotates them on the reference', () => {
    const tabId = setup()
    render(<Harness />)
    fireEvent.click(screen.getByRole('tab', { name: /Variants/ }))
    expect(screen.getByText('1 variant against the reference')).toBeInTheDocument()
    expect(screen.getByText(/K2E · Missense/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Annotate on the reference/ }))
    const tab = store().tabs.find(t => t.id === tabId)!
    const v = tab.doc.annotations.find(a => a.type === 'variation')
    expect(v).toMatchObject({ name: 'K2E', start: 6, end: 7 })
    // The contig is back on screen.
    expect(store().activeContigId).toBe(store().contigs[0].id)
  })

  it('reports the clone as differing, with coverage and the protein change', () => {
    setup()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Verify clone/ }))
    const dialog = screen.getByRole('dialog', { name: 'Clone verification' })
    expect(dialog).toHaveTextContent('Differences found')
    expect(dialog).toHaveTextContent('83.3% of 24 bp covered')
    expect(dialog).toHaveTextContent('K2E (missense)')
    expect(dialog).toHaveTextContent('Not covered: 21–24')
  })
})
