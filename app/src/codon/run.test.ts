/**
 * A whole optimization run.
 *
 * The pieces are tested on their own elsewhere; what matters here is that they
 * are wired together correctly, above all that the edits handed to the store
 * reproduce the optimized protein when applied to the real sequence.
 */
import { describe, it, expect } from 'vitest'
import { runOptimization, combinedMetrics } from './run'
import { ConstraintSet, DEFAULT_CONSTRAINTS } from './constraints'
import { geneticCode, translateWith } from './genetic-codes'
import { BUILTIN_USAGE_TABLES } from './usage-tables'
import { DEFAULT_TARGET_OPTIONS } from './targets'
import { DEFAULT_OPTIMIZE_OPTIONS } from './optimize'
import { Sequence } from '../models/Sequence'
import { Annotation, type AnnotationData } from '../models/Annotation'
import { reverseComplement } from '../models/complement'

const code = geneticCode(1)
const table = BUILTIN_USAGE_TABLES.find(t => t.id === 'ecoli-k12')!

/** ATG then eight rare-ish codons then TAA. */
const GENE = 'ATG' + 'CTACTAAGGAGAGGAATAAGTTCA'.match(/.{3}/g)!.join('') + 'TAA'

const ann = (over: Partial<AnnotationData> = {}) => new Annotation({
  id: 'cds1', name: 'gene', type: 'CDS', start: 0, end: GENE.length, strand: 1, ...over,
})

const run = (over: Partial<Parameters<typeof runOptimization>[0]> = {}) => runOptimization({
  kind: 'cds',
  sequence: new Sequence(GENE + 'AAACCCGGG', 'linear'),
  annotations: [ann()],
  code,
  table,
  constraints: new ConstraintSet(DEFAULT_CONSTRAINTS),
  targetOptions: DEFAULT_TARGET_OPTIONS,
  optimizeOptions: DEFAULT_OPTIMIZE_OPTIONS,
  ...over,
})

/** Apply the run's edits to a sequence the way the store does. */
function applyEdits(bases: string, edits: { start: number; end: number; bases: string }[]): string {
  const chars = bases.split('')
  for (const edit of edits) {
    expect(edit.end - edit.start).toBe(edit.bases.length)
    for (let i = 0; i < edit.bases.length; i++) chars[edit.start + i] = edit.bases[i]
  }
  return chars.join('')
}

describe('a run on a plus-strand gene', () => {
  it('produces edits that keep the protein when applied', () => {
    const original = GENE + 'AAACCCGGG'
    const result = run()
    const updated = applyEdits(original, result.edits)

    expect(updated).toHaveLength(original.length)
    expect(translateWith(code, updated.slice(0, GENE.length)))
      .toBe(translateWith(code, GENE))
    expect(updated.slice(GENE.length)).toBe('AAACCCGGG')
  })

  it('improves the adaptation index and clears the rare codons', () => {
    const [region] = run().regions
    expect(region.before.cai).not.toBeNull()
    expect(region.after.cai!).toBeGreaterThan(region.before.cai!)
    expect(region.after.rareCodons).toBeLessThan(region.before.rareCodons)
  })

  it('reports what it did', () => {
    const result = run()
    expect(result.totalChanges).toBeGreaterThan(0)
    expect(result.regions[0].identity).toBeLessThan(100)
    expect(result.regions[0].lockedCodons).toBe(2)   // start and stop
    expect(result.warnings).toEqual([])
  })

  it('leaves the start and stop codons alone', () => {
    const [region] = run().regions
    expect(region.optimizedBases.slice(0, 3)).toBe('ATG')
    expect(region.optimizedBases.slice(-3)).toBe('TAA')
  })
})

describe('a run on a minus-strand gene', () => {
  it('writes the reverse complement back to the plus strand', () => {
    const plus = reverseComplement(GENE) + 'AAACCCGGG'
    const result = run({
      sequence: new Sequence(plus, 'linear'),
      annotations: [ann({ strand: -1 })],
    })
    const updated = applyEdits(plus, result.edits)

    expect(result.regions[0].reverse).toBe(true)
    // Read back off the minus strand, the protein is unchanged.
    const coding = reverseComplement(updated.slice(0, GENE.length))
    expect(translateWith(code, coding)).toBe(translateWith(code, GENE))
  })
})

describe('a run on an origin-spanning gene', () => {
  it('splits the edits at the join and still keeps the protein', () => {
    const tail = GENE.slice(9)
    const head = GENE.slice(0, 9)
    const plus = tail + 'AAACCC' + head
    const start = plus.length - 9
    const result = run({
      sequence: new Sequence(plus, 'circular'),
      annotations: [ann({ start, end: tail.length })],
    })

    expect(result.regions).toHaveLength(1)
    expect(result.edits.length).toBeGreaterThan(1)

    const updated = applyEdits(plus, result.edits)
    const coding = updated.slice(start) + updated.slice(0, tail.length)
    expect(translateWith(code, coding)).toBe(translateWith(code, GENE))
  })
})

describe('context', () => {
  it('sees a motif that straddles the end of the region', () => {
    // The gene ends ...TAA and the sequence continues TTC: with GAATTC
    // forbidden, a run must not leave a GAA at the very end.
    const bases = 'ATGGAAGAAGAA' + 'TTCGGGAAA'
    const constraints = new ConstraintSet({
      ...DEFAULT_CONSTRAINTS, motifs: [{ name: 'EcoRI', sequence: 'GAATTC' }],
    })
    const result = runOptimization({
      kind: 'cds',
      sequence: new Sequence(bases, 'linear'),
      annotations: [ann({ end: 12 })],
      code, table, constraints,
      targetOptions: { ...DEFAULT_TARGET_OPTIONS, keepStopCodon: false },
      optimizeOptions: DEFAULT_OPTIMIZE_OPTIONS,
    })

    const updated = applyEdits(bases, result.edits)
    expect(updated).not.toContain('GAATTC')
  })
})

describe('warnings', () => {
  it('passes on what the target resolver could not do', () => {
    const result = run({ kind: 'selection', selection: null })
    expect(result.regions).toEqual([])
    expect(result.warnings[0]).toContain('No selection')
  })

  it('flags an amino acid the table cannot encode', () => {
    const crippled = { ...table, fractions: { ...table.fractions, TGG: 0 } }
    const result = run({
      table: crippled,
      sequence: new Sequence('ATGTGGTAA', 'linear'),
      annotations: [ann({ end: 9 })],
    })
    expect(result.warnings.join(' ')).toContain('no codon for W')
  })
})

describe('combinedMetrics', () => {
  it('returns the single region unchanged', () => {
    const { regions } = run()
    expect(combinedMetrics(regions, 'after')).toBe(regions[0].after)
    expect(combinedMetrics([], 'after')).toBeNull()
  })

  it('pools several regions by codon count', () => {
    const result = run({
      sequence: new Sequence(GENE + GENE, 'linear'),
      annotations: [ann(), ann({ id: 'cds2', start: GENE.length, end: GENE.length * 2 })],
    })
    const pooled = combinedMetrics(result.regions, 'before')!
    expect(pooled.codons).toBe(result.regions[0].before.codons * 2)
    expect(pooled.gc).toBeCloseTo(result.regions[0].before.gc, 6)
  })
})
