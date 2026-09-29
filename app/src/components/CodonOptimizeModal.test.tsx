/**
 * The codon optimization dialog.
 *
 * Covers the path a user actually takes: open it, let the preview run, apply.
 * The optimizer itself is tested in src/codon; what is checked here is that
 * the dialog feeds it the right document and writes the right thing back.
 */
import { render, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import CodonOptimizeModal from './CodonOptimizeModal'
import { useEditorStore } from '../store'
import { DEFAULT_CODON_SETTINGS } from '../codon/settings'
import { translate } from '../utils/codon'

const store = () => useEditorStore.getState()

/** ATG, six rare-in-E.-coli codons, TAA. */
const GENE = 'ATG' + 'CTACTAAGGAGAATAAGT'.match(/.{3}/g)!.join('') + 'TAA'
const FLANK = 'AAACCCGGGTTT'

/** The preview is debounced; give it room and let React flush. */
async function settle(ms = 350) {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })
}

function button(label: string): HTMLButtonElement | null {
  return [...document.querySelectorAll('button')]
    .find(b => b.textContent?.replace(/\s+/g, ' ').trim() === label) as HTMLButtonElement ?? null
}

function metricRow(label: string): string[] {
  const row = [...document.querySelectorAll('.cod-metrics tr')]
    .find(tr => tr.querySelector('td')?.textContent === label)
  if (!row) throw new Error(`no metric row "${label}"`)
  return [...row.querySelectorAll('td')].map(td => td.textContent ?? '')
}

async function openModal() {
  render(<CodonOptimizeModal open onClose={() => {}} />)
  await settle()
}

describe('codon optimization dialog', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pOpt', GENE + FLANK)
    store().addAnnotation({
      id: 'cds1', name: 'gene', type: 'CDS', start: 0, end: GENE.length, strand: 1,
    })
    store().setCodonSettings({ ...DEFAULT_CODON_SETTINGS })
  })

  it('previews a run against the coding feature', async () => {
    await openModal()

    const [, before, after] = metricRow('CAI')
    expect(Number(after)).toBeGreaterThan(Number(before))
    expect(document.body.textContent).toContain('codons changed')
  })

  it('lists the codons it would change', async () => {
    await openModal()
    const changes = document.querySelectorAll('.cod-change-list li')
    expect(changes.length).toBeGreaterThan(0)
    expect(changes[0].textContent).toMatch(/[ACGT]{3}/)
  })

  it('applies the run to the document as one undo step', async () => {
    await openModal()
    const original = store().doc.sequence.bases

    await act(async () => { button('Apply')!.click() })

    const updated = store().doc.sequence.bases
    expect(updated).not.toBe(original)
    expect(updated).toHaveLength(original.length)
    expect(translate(updated.slice(0, GENE.length))).toBe(translate(GENE))
    // The flank and the feature both survive.
    expect(updated.slice(GENE.length)).toBe(FLANK)
    expect(store().doc.annotations).toHaveLength(1)

    store().undo()
    expect(store().doc.sequence.bases).toBe(original)
  })

  it('can put the result in a new sequence and leave this one alone', async () => {
    await openModal()
    const original = store().doc.sequence.bases
    const tabsBefore = store().tabs.length

    await act(async () => { button('Open as new sequence')!.click() })

    expect(store().tabs).toHaveLength(tabsBefore + 1)
    expect(store().doc.name).toContain('(optimized)')
    expect(store().doc.sequence.bases).not.toBe(original)
    expect(translate(store().doc.sequence.bases.slice(0, GENE.length))).toBe(translate(GENE))

    const source = store().tabs.find(t => t.doc.name === 'pOpt')!
    expect(source.doc.sequence.bases).toBe(original)
  })

  it('honours the rare-codons-only mode', async () => {
    await act(async () => { store().setCodonSettings({ mode: 'rare-only', rareThreshold: 5 }) })
    await openModal()
    const fewChanges = document.querySelectorAll('.cod-change-list li').length

    await act(async () => { store().setCodonSettings({ mode: 'all' }) })
    await settle()
    const allChanges = document.querySelectorAll('.cod-change-list li').length

    expect(allChanges).toBeGreaterThan(fewChanges)
  })

  it('reports a constraint it cannot satisfy rather than failing', async () => {
    // Forbidding ATG leaves the locked start codon nowhere to go.
    await act(async () => { store().setCodonSettings({ customMotifs: 'ATG' }) })
    await openModal()

    expect(document.body.textContent).toContain('Could not satisfy everything')
    expect(button('Apply')).toBeTruthy()
  })

  it('refuses to apply to a read-only document', async () => {
    store().toggleReadOnly()
    await openModal()

    expect(button('Apply')!.disabled).toBe(true)
    expect(document.body.textContent).toContain('read-only')
    store().toggleReadOnly()
  })

  it('says when the target has nothing to work on', async () => {
    await act(async () => { store().setCodonSettings({ target: 'selection' }) })
    await openModal()
    expect(document.body.textContent).toContain('No selection')
  })
})
