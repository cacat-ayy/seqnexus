/**
 * Sequence constraints.
 *
 * The incremental check and the report run the same code on purpose, so each
 * constraint is exercised through `findViolations` and the window behaviour of
 * `violationsIn` is checked separately.
 */
import { describe, it, expect } from 'vitest'
import {
  ConstraintSet, DEFAULT_CONSTRAINTS, MOTIF_PRESETS, RepeatIndex,
  ENZYME_GROUP_OPTIONS, ALL_ENZYMES_GROUP, enzymeNamesInGroup,
  motifsForEnzymes, motifsForEnzymeGroup, parseCustomMotifs, gcPercentOf,
  type ConstraintOptions,
} from './constraints'

const opts = (over: Partial<ConstraintOptions> = {}): ConstraintOptions =>
  ({ ...DEFAULT_CONSTRAINTS, ...over })

const kinds = (set: ConstraintSet, seq: string) =>
  set.findViolations(seq).map(v => v.kind)

describe('motifs', () => {
  it('finds a site on either strand', () => {
    const set = new ConstraintSet(opts({ motifs: [{ name: 'BsaI', sequence: 'GGTCTC' }] }))
    expect(set.findViolations('AAAGGTCTCAAA')).toHaveLength(1)
    expect(set.findViolations('AAAGAGACCAAA')).toHaveLength(1)   // reverse strand
    expect(set.findViolations('AAAGGTATCAAA')).toHaveLength(0)
  })

  it('reports a palindromic site once, not twice', () => {
    const set = new ConstraintSet(opts({ motifs: [{ name: 'EcoRI', sequence: 'GAATTC' }] }))
    expect(set.findViolations('TTGAATTCTT')).toHaveLength(1)
  })

  it('expands IUPAC codes', () => {
    const set = new ConstraintSet(opts({ motifs: [{ name: 'DraIII', sequence: 'CACNNNGTG' }] }))
    expect(set.findViolations('AACACTTTGTGAA')).toHaveLength(1)
    expect(set.findViolations('AACACTTTGTCAA')).toHaveLength(0)
  })

  it('counts overlapping occurrences separately', () => {
    const set = new ConstraintSet(opts({ motifs: [{ name: 'AT-rich', sequence: 'ATAT' }] }))
    expect(set.findViolations('ATATAT')).toHaveLength(2)
  })

  it('names the violation so the report can explain itself', () => {
    const set = new ConstraintSet(opts({ motifs: [{ name: 'BsaI', sequence: 'GGTCTC' }] }))
    expect(set.findViolations('GGTCTC')[0].detail).toContain('BsaI')
    expect(set.findViolations('GAGACC')[0].detail).toContain('rev')
  })

  it('builds motif lists from the enzyme database', () => {
    const [ecoRI] = motifsForEnzymes(['EcoRI'])
    expect(ecoRI.sequence).toBe('GAATTC')
    expect(motifsForEnzymeGroup('Golden Gate (Type IIS)').length).toBeGreaterThan(0)
    expect(motifsForEnzymeGroup('Not a group')).toEqual([])
  })

  it('offers every enzyme category, with the catch-all first', () => {
    expect(ENZYME_GROUP_OPTIONS[0]).toBe(ALL_ENZYMES_GROUP)
    expect(ENZYME_GROUP_OPTIONS).toContain('Golden Gate (Type IIS)')
  })

  it('lists a category as a sorted, duplicate-free set of names', () => {
    const common = enzymeNamesInGroup('Common (6-cutters)')
    expect(common).toContain('EcoRI')
    expect([...common]).toEqual([...common].sort((a, b) => a.localeCompare(b)))
    expect(new Set(common).size).toBe(common.length)

    const all = enzymeNamesInGroup(ALL_ENZYMES_GROUP)
    expect(all.length).toBeGreaterThan(common.length)
    for (const name of common) expect(all).toContain(name)

    expect(enzymeNamesInGroup('Not a group')).toEqual([])
  })

  it('ships presets that actually carry sequences', () => {
    for (const preset of MOTIF_PRESETS) {
      expect(preset.motifs.length).toBeGreaterThan(0)
      for (const m of preset.motifs) expect(m.sequence).toMatch(/^[ACGTURYSWKMBDHVN]+$/)
    }
  })
})

describe('parseCustomMotifs', () => {
  it('reads one motif per line, with optional names', () => {
    expect(parseCustomMotifs('GAATTC\nmySite=GGWWCC')).toEqual([
      { name: 'GAATTC', sequence: 'GAATTC' },
      { name: 'mySite', sequence: 'GGWWCC' },
    ])
  })

  it('accepts commas and semicolons as separators and U as T', () => {
    expect(parseCustomMotifs('gaauuc, ggatcc')).toEqual([
      { name: 'GAATTC', sequence: 'GAATTC' },
      { name: 'GGATCC', sequence: 'GGATCC' },
    ])
  })

  it('drops anything that is not a nucleotide sequence', () => {
    expect(parseCustomMotifs('hello world\n\nGGATCC')).toEqual([
      { name: 'GGATCC', sequence: 'GGATCC' },
    ])
  })
})

describe('homopolymers', () => {
  it('applies separate limits to A/T and G/C', () => {
    const set = new ConstraintSet(opts({ maxHomopolymerAT: 4, maxHomopolymerGC: 2 }))
    expect(kinds(set, 'CAAAAG')).toEqual([])          // 4 A, at the limit
    expect(kinds(set, 'CAAAAAG')).toEqual(['homopolymer'])
    expect(kinds(set, 'AGGA')).toEqual([])            // 2 G, at the limit
    expect(kinds(set, 'AGGGA')).toEqual(['homopolymer'])
  })

  it('says how long the run was', () => {
    const set = new ConstraintSet(opts({ maxHomopolymerAT: 3 }))
    expect(set.findViolations('TTTTT')[0].detail).toContain('5 x T')
  })

  it('ignores the other base class when only one limit is set', () => {
    const set = new ConstraintSet(opts({ maxHomopolymerAT: 3 }))
    expect(kinds(set, 'GGGGGGGG')).toEqual([])
  })
})

describe('GC content', () => {
  it('reports the region as a whole against the global bounds', () => {
    const set = new ConstraintSet(opts({ minGC: 40, maxGC: 60 }))
    expect(kinds(set, 'ATATATATAT')).toEqual(['gc-global'])
    expect(kinds(set, 'ATGCATGCAT')).toEqual([])
  })

  it('reports a local window outside the bounds', () => {
    const set = new ConstraintSet(opts({ minGC: 30, maxGC: 70, gcWindow: 10 }))
    const seq = 'ATGCATGCAT'.repeat(2) + 'GCGCGCGCGC' + 'ATGCATGCAT'.repeat(2)
    expect(set.findViolations(seq).some(v => v.kind === 'gc-window')).toBe(true)
  })

  it('measures GC as a percentage of counted bases', () => {
    expect(gcPercentOf('GCAT')).toBe(50)
    expect(gcPercentOf('AAAA')).toBe(0)
    expect(gcPercentOf('')).toBe(0)
  })
})

describe('repeats and hairpins', () => {
  it('reports a direct repeat longer than the limit', () => {
    // The sequence repeats ACGTACGT, so it trips a 6 bp limit and clears an
    // 8 bp one.
    const seq = 'ACGTACGTTTTTACGTACGT'
    expect(kinds(new ConstraintSet(opts({ maxRepeat: 6 })), seq)).toContain('repeat')
    expect(kinds(new ConstraintSet(opts({ maxRepeat: 8 })), seq)).not.toContain('repeat')
  })

  it('reports an inverted repeat as a hairpin', () => {
    const set = new ConstraintSet(opts({ maxHairpinStem: 5, hairpinLoopMax: 10 }))
    // GGGGGG ... CCCCCC pairs as a 6 bp stem with a 4 bp loop.
    expect(kinds(set, 'AAGGGGGGTTTTCCCCCCAA')).toContain('hairpin')
    expect(kinds(set, 'AAGGGGGGTTTTGGGGGGAA')).not.toContain('hairpin')
  })

  it('ignores arms too far apart to pair', () => {
    const set = new ConstraintSet(opts({ maxHairpinStem: 5, hairpinLoopMax: 4 }))
    expect(kinds(set, 'AAGGGGGG' + 'T'.repeat(40) + 'CCCCCCAA')).not.toContain('hairpin')
  })
})

describe('CpG', () => {
  it('reports every CG dinucleotide when asked', () => {
    const set = new ConstraintSet(opts({ avoidCpG: true }))
    expect(set.findViolations('ACGTACG')).toHaveLength(2)
    expect(new ConstraintSet(opts()).findViolations('ACGTACG')).toHaveLength(0)
  })
})

describe('violationsIn', () => {
  const set = new ConstraintSet(opts({
    motifs: [{ name: 'EcoRI', sequence: 'GAATTC' }],
    maxHomopolymerAT: 3,
  }))

  it('reports only what touches the changed window', () => {
    const seq = 'GAATTC' + 'CCCC' + 'AAAAA'
    expect(set.violationsIn(seq, 0, 6).map(v => v.kind)).toEqual(['motif'])
    expect(set.violationsIn(seq, 10, 15).map(v => v.kind)).toEqual(['homopolymer'])
  })

  it('sees a motif the change only partly overlaps', () => {
    // The last base of the site is the only one inside the window.
    expect(set.violationsIn('AAGAATTCAA', 7, 8)).toHaveLength(1)
  })

  it('leaves global GC to the report', () => {
    const gcSet = new ConstraintSet(opts({ minGC: 40, maxGC: 60 }))
    expect(gcSet.violationsIn('ATATATATAT', 0, 10)).toHaveLength(0)
    expect(gcSet.findViolations('ATATATATAT')).toHaveLength(1)
  })

  it('knows when there is nothing to check', () => {
    expect(new ConstraintSet(opts()).isEmpty).toBe(true)
    expect(set.isEmpty).toBe(false)
  })
})

describe('RepeatIndex', () => {
  it('finds an earlier copy of a word and forgets it on rollback', () => {
    const index = new RepeatIndex(4)
    const added = index.add([{ word: 'ACGT', at: 0 }])

    expect(index.earlierMatch('ACGT', 4)).toBe(0)
    expect(index.earlierMatch('ACGT', 0)).toBe(-1)   // itself does not count
    index.rollback(added)
    expect(index.earlierMatch('ACGT', 4)).toBe(-1)
  })

  it('lists only the words a write completes', () => {
    const index = new RepeatIndex(4)
    // Writing bases 6, 7 and 8 completes the words starting at 3, 4 and 5.
    // The word at 6 needs base 9, which the next codon will write.
    expect(index.wordStarts(6, 9, 20)).toEqual([3, 4, 5])
    // Near the end of the sequence, words that would run off it are left out.
    expect(index.wordStarts(6, 9, 8)).toEqual([3, 4])
  })
})
