/**
 * The codon optimization dialog.
 *
 * Covers the path a user actually takes: open it, let the preview run, apply.
 * The optimizer itself is tested in src/codon; what is checked here is that
 * the dialog feeds it the right document and writes the right thing back.
 */
import { render, act, fireEvent } from '@testing-library/react'
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

function regionHead(): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>('.cod-region-head')
  if (!el) throw new Error('no region header')
  return el
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

  it('starts each region collapsed, with its change count in the header', async () => {
    await openModal()

    const head = document.querySelector<HTMLButtonElement>('.cod-region-head')!
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(head.textContent).toContain('gene')
    expect(head.textContent).toMatch(/\d+ changes?/)
    expect(document.querySelectorAll('.cod-change-list li')).toHaveLength(0)
  })

  it('lists the codons it would change once a region is opened', async () => {
    await openModal()
    await act(async () => { regionHead().click() })

    const changes = document.querySelectorAll('.cod-change-list li')
    expect(changes.length).toBeGreaterThan(0)
    expect(changes[0].textContent).toMatch(/[ACGT]{3}/)

    // And it closes again.
    await act(async () => { regionHead().click() })
    expect(document.querySelectorAll('.cod-change-list li')).toHaveLength(0)
  })

  it('applies the run to the document as one undo step', async () => {
    await openModal()
    const original = store().doc.sequence.bases

    await act(async () => { button('Apply to sequence')!.click() })

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
    // Read the counts off the collapsed headers rather than opening them.
    const changeCount = () => Number(/(\d+) changes?/.exec(regionHead().textContent ?? '')![1])

    await act(async () => { store().setCodonSettings({ mode: 'rare-only', rareThreshold: 5 }) })
    await openModal()
    const fewChanges = changeCount()

    await act(async () => { store().setCodonSettings({ mode: 'all' }) })
    await settle()

    expect(changeCount()).toBeGreaterThan(fewChanges)
  })

  it('reports a constraint it cannot satisfy rather than failing', async () => {
    // Forbidding ATG leaves the locked start codon nowhere to go.
    await act(async () => { store().setCodonSettings({ customMotifs: 'ATG' }) })
    await openModal()

    expect(document.body.textContent).toContain('Could not satisfy everything')
    expect(button('Apply to sequence')).toBeTruthy()
  })

  it('lists a whole enzyme category once one is chosen, and filters it', async () => {
    await openModal()
    const select = document.querySelector<HTMLSelectElement>('#cod-enzyme-group')!
    expect(document.querySelectorAll('.cod-enzyme-list li')).toHaveLength(0)

    await act(async () => { fireEvent.change(select, { target: { value: 'Common (6-cutters)' } }) })

    const names = () => [...document.querySelectorAll('.cod-enzyme-name')]
      .map(el => el.textContent)
    expect(names().length).toBeGreaterThan(5)
    expect(names()).toContain('EcoRI')
    // Every enzyme of the category starts ticked.
    expect(store().codonSettings.enzymeExcluded).toEqual([])

    const search = document.querySelector<HTMLInputElement>('.cod-enzyme-search input')!
    await act(async () => { fireEvent.change(search, { target: { value: 'ecor' } }) })
    expect(names()).toEqual(['EcoRI', 'EcoRV'])
  })

  it('stops avoiding an enzyme when it is unticked', async () => {
    await act(async () => {
      store().setCodonSettings({ enzymeGroup: 'Common (6-cutters)', enzymeExcluded: [] })
    })
    await openModal()

    const rowFor = (name: string) =>
      [...document.querySelectorAll('.cod-enzyme-list li')]
        .find(li => li.querySelector('.cod-enzyme-name')?.textContent === name)!
    const box = rowFor('EcoRI').querySelector('input')!
    expect(box.checked).toBe(true)

    await act(async () => { box.click() })

    expect(store().codonSettings.enzymeExcluded).toEqual(['EcoRI'])
    expect(rowFor('EcoRI').querySelector('input')!.checked).toBe(false)

    await act(async () => { store().setCodonSettings({ ...DEFAULT_CODON_SETTINGS }) })
  })

  it('refuses to apply to a read-only document', async () => {
    store().toggleReadOnly()
    await openModal()

    const apply = button('Apply to sequence')!
    expect(apply.disabled).toBe(true)
    // The footer note is gone; the reason lives on the control it applies to.
    expect(apply.title).toContain('read-only')
    store().toggleReadOnly()
  })

  it('says when the target has nothing to work on', async () => {
    await act(async () => { store().setCodonSettings({ target: 'selection' }) })
    await openModal()
    expect(document.body.textContent).toContain('No selection')
  })
})
