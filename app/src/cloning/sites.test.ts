import { describe, it, expect } from 'vitest'
import { PUC19_SEQUENCE } from '../demo'
import { Sequence } from '../models/Sequence'
import { getEnzyme } from '../enzymes/db'
import { mapEnzymes, mapSites } from './sites'
import { digest } from './cut'
import { endView } from './endview'

describe('the enzymes a map offers', () => {
  it('has one name per specificity, and the name people use', () => {
    const names = mapEnzymes().map(e => e.name)
    expect(names).toContain('BamHI')
    expect(names).toContain('EcoRI')
    expect(names).toContain('NotI')
    // Isoschizomers of BamHI and EcoRI with the same cut are folded in.
    const recognitions = mapEnzymes().map(e => `${e.recognition}/${e.fwd_cut}/${e.rev_cut}`)
    expect(new Set(recognitions).size).toBe(recognitions.length)
  })

  it('keeps out Type IIS enzymes and four-cutters', () => {
    const names = new Set(mapEnzymes().map(e => e.name))
    expect(names.has('BsaI')).toBe(false)
    expect(names.has('MboI')).toBe(false)
  })

  it('keeps neoschizomers apart, since they leave different ends', () => {
    const names = new Set(mapEnzymes().map(e => e.name))
    expect(names.has('SmaI')).toBe(true)
    expect(names.has('XmaI')).toBe(true)
  })
})

describe('the sites on a part’s map', () => {
  const puc = { bases: PUC19_SEQUENCE, topology: 'circular' as const, extra: [], chosen: [] }

  it('shows the single cutters in pUC19’s multiple cloning site', () => {
    const labels = mapSites(puc).sites.flatMap(s => s.enzymes)
    for (const name of ['EcoRI', 'KpnI', 'BamHI', 'XbaI', 'SalI', 'PstI', 'HindIII']) {
      expect(labels).toContain(name)
    }
  })

  it('leaves out enzymes that cut more than once unless the design names them', () => {
    // PvuII cuts pUC19 twice.
    expect(mapSites(puc).sites.some(s => s.enzymes.includes('PvuII'))).toBe(false)
    const named = mapSites({ ...puc, extra: ['PvuII'] }).sites.filter(s => s.enzymes.includes('PvuII'))
    expect(named).toHaveLength(2)
    expect(named[0].cuts).toBe(2)
  })

  it('marks the chosen enzymes’ sites', () => {
    const { sites, picked } = mapSites({ ...puc, chosen: ['EcoRI', 'HindIII'] })
    const chosen = sites.filter(s => picked.has(s.key)).map(s => s.enzymes[0])
    expect(chosen.sort()).toEqual(['EcoRI', 'HindIII'])
  })

  it('can show only what the design names', () => {
    const { sites } = mapSites({ ...puc, extra: ['BsaI'], onlyNamed: true })
    expect(sites.every(s => s.enzymes.includes('BsaI'))).toBe(true)
    expect(sites.length).toBeGreaterThan(0)
  })
})

describe('an end drawn as its two strands', () => {
  const doc = { name: 'pUC19', sequence: new Sequence(PUC19_SEQUENCE, 'circular' as const), annotations: [] }
  const backbone = digest(doc, [getEnzyme('EcoRI')!, getEnzyme('HindIII')!]).fragments
    .reduce((a, b) => (b.top.length > a.top.length ? b : a))

  it('shows a 5′ overhang sticking out of the top strand on the left', () => {
    // pUC19's backbone after EcoRI + HindIII starts at the HindIII cut.
    const left = endView(backbone, 'left')!
    expect(left.top.startsWith('AGCT')).toBe(true)
    expect(left.bottom.startsWith('    ')).toBe(true)
    expect(left.top.length).toBe(left.bottom.length)
  })

  it('shows a 5′ overhang sticking out of the bottom strand on the right', () => {
    const right = endView(backbone, 'right')!
    // EcoRI's AATT, read 3'→5' on the bottom strand.
    expect(right.bottom.endsWith('TTAA')).toBe(true)
    expect(right.top.endsWith('    ')).toBe(true)
  })

  it('pairs every double-stranded base', () => {
    const pair: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' }
    for (const view of [endView(backbone, 'left')!, endView(backbone, 'right')!]) {
      for (let i = 0; i < view.top.length; i++) {
        if (view.top[i] !== ' ' && view.bottom[i] !== ' ') expect(pair[view.top[i]]).toBe(view.bottom[i])
      }
    }
  })

  it('draws a blunt end flush and a 3′ overhang on the top strand at the right', () => {
    const pst = digest(doc, [getEnzyme('PstI')!]).fragments[0]
    const right = endView(pst, 'right')!
    expect(right.top.endsWith('TGCA')).toBe(true)
    expect(right.bottom.endsWith('    ')).toBe(true)
    const sma = digest(doc, [getEnzyme('SmaI')!]).fragments[0]
    const blunt = endView(sma, 'left')!
    expect(blunt.top.includes(' ') || blunt.bottom.includes(' ')).toBe(false)
  })
})
