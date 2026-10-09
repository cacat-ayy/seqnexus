/**
 * The numbers are checked against ExPASy ProtParam for a 121-residue protein
 * whose report is public, so any drift in a constant shows up here.
 */
import { describe, it, expect } from 'vitest'
import {
  proteinMass, proteinFormula, formatFormula, chargeGroups, isoelectricPoint, netCharge,
  extinction, gravy, aliphaticIndex, instabilityIndex, aromaticity, pkaSet, proteinProperties, formatMass,
} from './properties'

const P121 = 'MNKPQTIYEKLGGENAMKAAVPLFYKKVLADERVKHFFKNTDMDHQTKQQTDFLTMLLGGPNHYKGKNMTEAHKGMNLQNLHFDAIIENLAATLKELGVTDAVINEAAKVIEHTRKDMLGK'

describe('protein properties against ProtParam', () => {
  it('mass and formula', () => {
    expect(P121.length).toBe(121)
    expect(proteinMass(P121).average).toBeCloseTo(13683.8, 0)
    const f = proteinFormula(P121)
    expect(formatFormula(f)).toBe('C606H972N168O178S7')
    expect(f.atoms).toBe(1931)
  })

  it('charged residues and isoelectric point', () => {
    const g = chargeGroups(P121)
    expect(g.D + g.E).toBe(15)
    expect(g.K + g.R).toBe(17)
    // ProtParam uses the Bjellqvist set: 8.78.
    expect(isoelectricPoint(g, pkaSet('bjellqvist'))!).toBeCloseTo(8.78, 1)
    // Charge falls with pH and is zero at the pI.
    const set = pkaSet('emboss')
    const pI = isoelectricPoint(g, set)!
    expect(netCharge(g, pI, set)).toBeCloseTo(0, 2)
    expect(netCharge(g, 2, set)).toBeGreaterThan(netCharge(g, 12, set))
  })

  it('indices', () => {
    expect(gravy(P121)!).toBeCloseTo(-0.545, 3)
    expect(aliphaticIndex(P121)!).toBeCloseTo(78.26, 2)
    // 25.90 here against 25.91 there: one dipeptide weight differs in the
    // second decimal between published copies of the table.
    expect(Math.abs(instabilityIndex(P121)! - 25.91)).toBeLessThan(0.02)
    expect(aromaticity('FWYA')!).toBeCloseTo(0.75)
  })

  it('extinction coefficient after Pace', () => {
    // 2 Trp, 3 Tyr, 4 Cys.
    const e = extinction('WWYYYCCCC', 1, 1000)
    expect(e.reduced).toBe(2 * 5500 + 3 * 1490)
    expect(e.allCystine).toBe(e.reduced + 2 * 125)
    expect(e.annotated).toBe(e.reduced + 125)
    expect(e.a280Reduced).toBeCloseTo(e.reduced / 1000)
  })

  it('handles ambiguity codes, stops and an empty chain', () => {
    expect(proteinMass('').average).toBe(0)
    expect(proteinMass('MK*').average).toBeCloseTo(proteinMass('MK').average)
    expect(proteinMass('B').average).toBeCloseTo((115.0886 + 114.1038) / 2 + 18.01524, 3)
    expect(instabilityIndex('M')).toBeNull()
    expect(gravy('XB')).toBeNull()
    const p = proteinProperties('', 0, pkaSet('emboss'))
    expect(p.pI).toBeNull()
    expect(p.length).toBe(0)
  })

  it('formats masses', () => {
    expect(formatMass(13683.8)).toBe('13.7 kDa')
    expect(formatMass(856.93)).toBe('856.9 Da')
  })
})
