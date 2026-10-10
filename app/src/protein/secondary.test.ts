import { describe, it, expect } from 'vitest'
import { chouFasman, CF_HELIX, CF_SHEET, CF_TURN } from './secondary'

describe('Chou-Fasman', () => {
  it('tabulates the twenty residues with the known extremes', () => {
    for (const t of [CF_HELIX, CF_SHEET, CF_TURN]) expect(Object.keys(t)).toHaveLength(20)
    expect(CF_HELIX.E).toBeCloseTo(1.51)
    expect(CF_HELIX.G).toBeCloseTo(0.57)
    expect(CF_SHEET.V).toBeCloseTo(1.70)
    expect(CF_TURN.N).toBeCloseTo(1.56)
  })

  it('predicts a helix in a run of helix formers', () => {
    const segs = chouFasman('GGSG' + 'EAELLKEAMEALKKAA' + 'GSGG')
    expect(segs.some(s => s.kind === 'helix' && s.start <= 5 && s.end >= 18)).toBe(true)
    expect(segs.some(s => s.kind === 'strand')).toBe(false)
  })

  it('predicts a strand in a run of strand formers', () => {
    const segs = chouFasman('GGSG' + 'VIVTVYIVT' + 'GSGG')
    expect(segs.some(s => s.kind === 'strand' && s.end - s.start >= 5)).toBe(true)
  })

  it('finds nothing in glycine and proline', () => {
    expect(chouFasman('GPGPGPGPGPGPGPGP')).toEqual([])
  })

  it('returns non-overlapping segments in order', () => {
    const segs = chouFasman('MEELLKKAEELLKKVIVTVYIVTGSGEELLKKAEEL')
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].start).toBeGreaterThanOrEqual(segs[i - 1].end)
    }
  })
})
