import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import EnzymeTooltip from './EnzymeTooltip'
import { PinnedCardContext } from './hoverCardPinned'
import { getEnzyme } from '../enzymes/db'
import { findCutSites, type CutSite } from '../enzymes/finder'
import { groupCutSites, cutCountsByEnzyme } from '../enzymes/grouping'
import type { MethylationContext } from '../enzymes/methylation'

const pad = 'A'.repeat(20)

/** The card for the first site of `names` in `bases`, as the views build it. */
function card(bases: string, names: string[], { pinned = false } = {}) {
  const sites: CutSite[] = names.flatMap(n => findCutSites(bases, getEnzyme(n)!)).sort((a, b) => a.position - b.position)
  const methylation: MethylationContext = { bases, topology: 'linear', dam: false, dcm: false }
  const [group] = groupCutSites(sites, methylation)
  const el = <EnzymeTooltip x={0} y={0} group={group} ctx={{ methylation, cutCounts: cutCountsByEnzyme(sites) }} />
  return render(pinned ? <PinnedCardContext.Provider value>{el}</PinnedCardContext.Provider> : el)
}

describe('EnzymeTooltip', () => {
  afterEach(cleanup)

  it('names the enzyme as written, with how many times it cuts and the overhang it leaves', () => {
    const { container } = card(pad + 'CATATG' + pad + 'CATATG' + pad, ['NdeI'])
    expect(container.querySelector('.enzyme-tooltip-name')?.textContent).toBe('NdeI')
    expect(screen.getByText('2×')).toBeTruthy()
    expect(container.querySelector('.enzyme-tooltip-table')?.textContent).toContain('5′ TA')
  })

  it('reads a Type IIS overhang off the sequence, and draws those bases', () => {
    const { container } = card(pad + 'GGTCTC' + 'A' + 'CGTA' + pad, ['BsaI'])
    expect(container.querySelector('.enzyme-tooltip-table')?.textContent).toContain('5′ CGTA')
    const top = [...container.querySelectorAll('.ecd-base')].filter(e => (e as HTMLElement).style.gridRow === '1')
    expect(top.map(e => e.textContent).join('')).toContain('GGTCTCACGTA')
  })

  it('draws a reverse-strand site where it cuts on the top strand, and says which strand', () => {
    const { container } = card(pad + 'TACG' + 'T' + 'GAGACC' + pad, ['BsaI'])
    const table = container.querySelector('.enzyme-tooltip-table')?.textContent
    expect(table).toContain('5′ TACG')
    expect(table).toContain('bottom strand')
  })

  it('draws the step: top cut, the overhang between the strands, bottom cut', () => {
    const { container } = card(pad + 'GAATTC' + pad, ['EcoRI'])
    const top = container.querySelector('.ecd-cut-top')
    const bottom = container.querySelector('.ecd-cut-bottom')
    expect(top?.textContent).toBe('A')
    expect(bottom?.textContent).toBe('G')
    expect([...container.querySelectorAll('.ecd-cut-across')].map(e => e.textContent).join('')).toBe('AATT')
  })

  it('keeps temperature and heat inactivation on one row', () => {
    const { container } = card(pad + 'GAATTC' + pad, ['EcoRI'])
    expect(container.querySelector('.enzyme-tooltip-table')?.textContent).toContain('37°C · inactivate at 65°C')
  })

  it('lists a shared site compactly, and draws every cut once pinned', () => {
    const bases = pad + 'CCCGGG' + pad
    const hover = card(bases, ['SmaI', 'XmaI'])
    expect(hover.container.querySelectorAll('.enzyme-group-name')).toHaveLength(2)
    expect(hover.container.querySelectorAll('.enzyme-cut-diagram')).toHaveLength(0)
    expect(hover.container.textContent).toContain('2 different cuts here')
    cleanup()
    const pinned = card(bases, ['SmaI', 'XmaI'], { pinned: true })
    expect(pinned.container.querySelectorAll('.enzyme-cut-diagram')).toHaveLength(2)
  })
})
