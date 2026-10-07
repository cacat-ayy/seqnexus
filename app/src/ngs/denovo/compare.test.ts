import { describe, expect, it } from 'vitest'
import { compareToExpected, liftFeatures, revcomp } from './compare'
import { verifyContig } from './verifyContig'
import { lineUpContigs, lineUpTargets } from './lineup'
import { DEFAULT_VERIFY } from '../../assembly/verify'
import { randomSequence, rng } from './simulate'
import type { AnnotationData } from '../../models/Annotation'

const feat = (id: string, start: number, end: number, strand: 1 | -1 = 1): AnnotationData => ({ id, name: id, type: 'CDS', start, end, strand })

describe('contig against the expected sequence', () => {
  const expected = randomSequence(5000, rng(31))

  it('finds the strand and the start of a circular contig, and its three differences', () => {
    // Expected with a substitution at 1000, 3 bases inserted after 2000, 5 deleted at 3000.
    const sub = expected[1000] === 'A' ? 'C' : 'A'
    const edited = expected.slice(0, 1000) + sub + expected.slice(1001, 2001) + 'GGG' + expected.slice(2001, 3000) + expected.slice(3005)
    // Sequenced on the other strand, starting elsewhere.
    const rc = revcomp(edited)
    const contig = rc.slice(1234) + rc.slice(0, 1234)
    const c = compareToExpected({ contig, contigCircular: true, expected, expectedCircular: true })
    expect(c.reversed).toBe(true)
    expect(c.bases).toBe(edited)
    expect(c.differences).toEqual([
      { type: 'SNP', pos: 1000, ref: expected[1000], alt: sub },
      { type: 'Insertion', pos: 2000, ref: '', alt: 'GGG' },
      { type: 'Deletion', pos: 3000, ref: expected.slice(3000, 3005), alt: '' },
    ].map(d => expect.objectContaining(d)))
    expect(c.toContig[0]).toBe(0)
    expect(c.toContig[3002]).toBe(-1)
    expect(c.toExpected[2001]).toBe(-1)
  })

  it('spans a large deletion (a mixed clone) in one alignment', () => {
    const del = expected.slice(0, 2100) + expected.slice(2900)
    const c = compareToExpected({ contig: del.slice(400) + del.slice(0, 400), contigCircular: true, expected, expectedCircular: true })
    expect(c.reversed).toBe(false)
    expect(c.bases).toBe(del)
    expect(c.differences.length).toBe(1)
    expect(c.differences[0]).toMatchObject({ type: 'Deletion', ref: expected.slice(2100, 2900) })
  })

  it('places a linear contig across the origin of a circular expected sequence', () => {
    const amplicon = expected.slice(4500) + expected.slice(0, 700)
    const c = compareToExpected({ contig: revcomp(amplicon), contigCircular: false, expected, expectedCircular: true })
    expect(c.reversed).toBe(true)
    expect(c.differences).toEqual([])
    expect(c.from).toBe(4500)
    expect(c.to).toBe(700)
    expect(c.toContig[0]).toBe(500)
    expect(c.toContig[1000]).toBe(-1)
  })

  it('refuses a contig that is something else', () => {
    expect(() => compareToExpected({ contig: randomSequence(3000, rng(32)), contigCircular: true, expected, expectedCircular: true })).toThrow(/does not look like/)
  })

  it('verifies features: changed, not covered by enough reads, or verified', () => {
    // A codon in the CDS at 300..600 changed; the rest as designed.
    const p = 330
    const alt = expected[p] === 'A' ? 'C' : 'A'
    const contig = expected.slice(0, p) + alt + expected.slice(p + 1)
    const cmp = compareToExpected({ contig, contigCircular: true, expected, expectedCircular: true })
    const features = [
      { id: 'cds', name: 'geneA', type: 'CDS', start: 300, end: 600, strand: 1 as const },
      { id: 'ori', name: 'ori', type: 'rep_origin', start: 2000, end: 2600, strand: 1 as const },
      { id: 'low', name: 'thin', type: 'promoter', start: 4000, end: 4100, strand: 1 as const },
    ]
    const depth = new Uint32Array(contig.length).fill(40)
    depth.fill(4, 4050, 4060)
    const r = verifyContig({ cmp, expected: { name: 'pX', bases: expected, circular: true }, features, depth, reads: 1000, settings: { ...DEFAULT_VERIFY, minDepth: 10 } })
    const status = Object.fromEntries(r.features.map(f => [f.feature.id, f.status]))
    expect(status).toEqual({ cds: 'differences', ori: 'verified', low: 'incomplete' })
    expect(r.verdict).toBe('differences')
    // Codon 11 of the CDS ((330 - 300) / 3 + 1).
    expect(r.differences[0].coding?.protein).toMatch(/^[A-Z*]11[A-Z*]$/)
    expect(r.differences[0].coverage).toBe(40)
  })

  it('lifts features over, leaving out deleted ones and noting changed ones', () => {
    const edited = expected.slice(0, 1500) + expected.slice(1600, 3000) + 'AAAA' + expected.slice(3000)
    const c = compareToExpected({ contig: edited, contigCircular: true, expected, expectedCircular: true })
    const lifted = liftFeatures([
      feat('before', 100, 400), feat('gone', 1510, 1590), feat('cut', 1400, 1700),
      feat('grown', 2900, 3100, -1), feat('origin', 4900, 50),
    ], c, true)
    expect(lifted.dropped).toEqual(['gone'])
    expect(lifted.changed.sort()).toEqual(['cut', 'grown'])
    const by = Object.fromEntries(lifted.features.map(f => [f.id, f]))
    expect([by.before.start, by.before.end]).toEqual([100, 400])
    expect(c.bases.slice(by.grown.start, by.grown.end)).toBe(expected.slice(2900, 3000) + 'AAAA' + expected.slice(3000, 3100))
    expect(by.grown.strand).toBe(-1)
    expect(by.origin.start).toBeGreaterThan(by.origin.end)
    expect(c.bases.slice(by.origin.start) + c.bases.slice(0, by.origin.end)).toBe(expected.slice(4900) + expected.slice(0, 50))
  })
})

describe('lining contigs up as they are assembled', () => {
  it('turns each contig to the open sequence it matches, and links only exact-length ones', () => {
    const a = randomSequence(4000, rng(41))
    const b = randomSequence(3000, rng(42))
    const snp = a.slice(0, 500) + (a[500] === 'A' ? 'G' : 'A') + a.slice(501)
    const del = a.slice(0, 1000) + a.slice(1300)
    const rc = revcomp(snp)
    const contigs = [
      { name: 'Contig 1', bases: rc.slice(700) + rc.slice(0, 700), circular: true },
      { name: 'Contig 2', bases: del.slice(2000) + del.slice(0, 2000), circular: true },
      { name: 'Contig 3', bases: randomSequence(2000, rng(43)), circular: true },
    ]
    const targets = [
      { name: 'pB', tabId: 'tb', bases: b, circular: true },
      { name: 'pA', tabId: 'ta', bases: a, circular: true },
    ]
    const r = lineUpContigs(contigs, targets)
    expect(r.contigs[0]).toMatchObject({ bases: snp, tabId: 'ta' })
    expect(r.contigs[1]).toMatchObject({ bases: del, tabId: null })
    expect(r.contigs[2]).toBe(contigs[2])
    expect(r.matched.map(m => [m.contig, m.expected, m.reversed, m.linked])).toEqual([[0, 'pA', true, true], [1, 'pA', false, false]])
    expect(lineUpTargets([{ id: 't', doc: { name: 'x', sequence: { bases: 'A'.repeat(50), topology: 'linear', length: 50 } } }], 'auto')).toEqual([])
  })
})
