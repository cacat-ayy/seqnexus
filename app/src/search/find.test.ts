import { describe, it, expect } from 'vitest'
import {
  findMatches, defaultSearchOptions, matchContext, mismatchPositions, featureForHit, cleanReplacement,
  MAX_MATCHES, type SearchOptions, type SearchMatch,
} from './find'
import { geneticCode } from '../codon/genetic-codes'

const STD = geneticCode(1)
const opts = (o: Partial<SearchOptions> = {}): SearchOptions => ({ ...defaultSearchOptions, ...o })
const find = (q: string, bases: string, o: Partial<SearchOptions> = {}, circular = false, code = STD) =>
  findMatches(q, opts(o), bases, circular, code)
const spans = (ms: SearchMatch[]) => ms.map(m => [m.start, m.end, m.strand])

describe('nucleotide search', () => {
  it('finds both strands and says which', () => {
    // ATGC forward at 0; its reverse complement GCAT at 8.
    const r = find('ATGC', 'ATGCTTTTGCAT')
    expect(spans(r.matches)).toEqual([[0, 4, 1], [8, 12, -1]])
  })

  it('reports a palindrome once, on both strands', () => {
    expect(spans(find('GAATTC', 'CCGAATTCCC').matches)).toEqual([[2, 8, 0]])
  })

  it('merges a window an ambiguous query fits on both strands', () => {
    // AN and its reverse complement NT both fit "AT": one hit, not two.
    const r = find('AN', 'CCCATCCC')
    expect(spans(r.matches)).toEqual([[3, 5, 0]])
  })

  it('finds overlapping sites', () => {
    expect(find('AA', 'AAAA', { revComplement: false }).matches.map(m => m.start)).toEqual([0, 1, 2])
  })

  it('ignores spaces and position numbers pasted with a sequence', () => {
    expect(find('1 gaa ttc', 'CCGAATTCCC').matches).toHaveLength(1)
  })

  it('names characters that are not nucleotide codes instead of matching around them', () => {
    const r = find('GAATTZ', 'GGAATTCGAATTC')
    expect(r.matches).toEqual([])
    expect(r.error).toBe('“Z” is not a nucleotide code')
  })

  it('reads ambiguity codes only when asked to', () => {
    expect(find('GANTC', 'GGAATCC').matches).toHaveLength(1)
    expect(find('GANTC', 'GGAATCC', { ambiguity: false }).matches).toHaveLength(0)
    expect(find('GANTC', 'GGANTCC', { ambiguity: false }).matches).toHaveLength(1)
  })

  it('reports a broken regex rather than finding nothing', () => {
    const r = find('GA[AT', 'GAATTC', { isRegex: true })
    expect(r.error).toMatch(/character class/i)
  })

  it('searches a regex on the forward strand only', () => {
    expect(spans(find('GCA.', 'ATGCTTTTGCAT', { isRegex: true }).matches)).toEqual([[8, 12, 1]])
  })

  it('finds hits across the origin of a circular sequence, on both strands', () => {
    // ...GA|ATTC... forward, and ...GC|AT... as the reverse of ATGC.
    expect(spans(find('GAATTC', 'TTCGGGGGGGGGAA', {}, true).matches)).toEqual([[11, 17, 0]])
    const rc = find('ATGC', 'ATGGGGGGGGGGGC', {}, true)
    expect(spans(rc.matches)).toEqual([[12, 16, -1]])
    // Not on a linear sequence.
    expect(find('ATGC', 'ATGGGGGGGGGGGC').matches).toEqual([])
  })

  it('keeps the first MAX_MATCHES hits of a huge result instead of failing', () => {
    const bases = 'ACGT'.repeat(150_000)
    const r = find('A', bases)
    expect(r.truncated).toBe(true)
    expect(r.matches.length).toBeLessThanOrEqual(MAX_MATCHES)
    expect(r.matches.length).toBeGreaterThan(MAX_MATCHES / 2)
    // Sorted, and a complete prefix: no gap where one strand ran out.
    for (let i = 1; i < r.matches.length; i++) expect(r.matches[i].start).toBeGreaterThan(r.matches[i - 1].start)
  })
})

describe('mismatches', () => {
  it('finds a site with one base different, and counts it', () => {
    const r = find('GAATTC', 'CCGACTTCCC', { mismatches: 1, revComplement: false })
    expect(r.matches.map(m => [m.start, m.mismatches])).toEqual([[2, 1]])
    expect(find('GAATTC', 'CCGACTTCCC', { mismatches: 0 }).matches).toEqual([])
  })

  it('searches the reverse strand too', () => {
    // CTTGC is the reverse complement of GCAAG, one off GCATG.
    const r = find('GCATG', 'TTTCTTGCTTT', { mismatches: 1 })
    expect(r.matches.some(m => m.strand === -1 && m.start === 3)).toBe(true)
  })

  it('treats ambiguity codes as sets, and a sequence N as no match', () => {
    expect(find('GANTC', 'GGACTCC', { mismatches: 1, revComplement: false }).matches[0].mismatches).toBe(0)
    expect(find('GAATC', 'GGANTCC', { mismatches: 1, revComplement: false }).matches[0].mismatches).toBe(1)
  })

  it('marks the differing positions', () => {
    expect(mismatchPositions('GACTTC', 'GAATTC', true)).toEqual([2])
  })
})

describe('protein search', () => {
  it('searches all six frames', () => {
    // ATG AAA ACC = MKT, reverse-complemented into the sequence.
    const r = find('MKT', 'CCGGTTTTCATCC', { mode: 'protein' })
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0]).toMatchObject({ start: 2, end: 11, strand: -1 })
    expect(find('MKT', 'CCGGTTTTCATCC', { mode: 'protein', revComplement: false }).matches).toEqual([])
  })

  it('reports the frame', () => {
    const r = find('MKT', 'GATGAAAACC', { mode: 'protein', revComplement: false })
    expect(r.matches[0]).toMatchObject({ start: 1, end: 10, strand: 1, frame: 1 })
  })

  it('reads X as any residue', () => {
    expect(find('MXT', 'ATGAAAACC', { mode: 'protein' }).matches).toHaveLength(1)
    expect(find('MXT', 'ATGAAAACC', { mode: 'protein', ambiguity: false }).matches).toHaveLength(0)
  })

  it('translates with the chosen genetic code', () => {
    // TGA is a stop in the standard code and tryptophan in code 4.
    expect(find('MW', 'ATGTGA', { mode: 'protein' }).matches).toHaveLength(0)
    expect(find('MW', 'ATGTGA', { mode: 'protein' }, false, geneticCode(4)).matches).toHaveLength(1)
  })

  it('finds a protein hit across the origin', () => {
    // ATG|AAAACC split across the origin.
    const r = find('MKT', 'AAAACCGGGGGGATG', { mode: 'protein', revComplement: false }, true)
    expect(r.matches.map(m => [m.start, m.end])).toEqual([[12, 21]])
  })

  it('names characters that are not amino acids', () => {
    expect(find('MK1O', 'ATG', { mode: 'protein' }).error).toBe('“O” is not an amino acid code')
  })
})

describe('results helpers', () => {
  it('reads a reverse-strand hit and its context as the query reads', () => {
    const bases = 'TTTTGCATAAAA'
    const m: SearchMatch = { start: 4, end: 8, strand: -1, mismatches: 0 }
    const c = matchContext(m, 2, bases.length, false, (s, e) => bases.slice(s, e))
    expect(c).toEqual({ before: 'TT', hit: 'ATGC', after: 'AA' })
  })

  it('wraps context round the origin of a circular sequence', () => {
    const bases = 'CDEFGHAB'.replace(/[^ACGT]/g, 'A')
    const m: SearchMatch = { start: 6, end: 10, strand: 1, mismatches: 0 }
    const c = matchContext(m, 1, bases.length, true, (s, e) => bases.slice(s, e))
    expect(c.hit).toBe(bases.slice(6) + bases.slice(0, 2))
  })

  it('names the smallest feature holding a hit, skipping source', () => {
    const features = [
      { name: 'all', type: 'source', start: 0, end: 100 },
      { name: 'gene', type: 'gene', start: 10, end: 80 },
      { name: 'cds', type: 'CDS', start: 20, end: 60 },
      { name: 'wrap', type: 'misc_feature', start: 95, end: 5 },
    ]
    expect(featureForHit({ start: 30, end: 36, strand: 1, mismatches: 0 }, features, 100)?.name).toBe('cds')
    expect(featureForHit({ start: 97, end: 103, strand: 1, mismatches: 0 }, features, 100)?.name).toBe('wrap')
    expect(featureForHit({ start: 85, end: 90, strand: 1, mismatches: 0 }, features, 100)).toBeNull()
  })

  it('accepts only bases as a replacement', () => {
    expect(cleanReplacement('gaa ttc')).toEqual({ bases: 'GAATTC', error: null })
    expect(cleanReplacement('GAQ').error).toBe('“Q” is not a nucleotide code')
    // MKA is valid IUPAC, but for a protein hit it is surely a peptide.
    expect(cleanReplacement('MKA').error).toBeNull()
    expect(cleanReplacement('MKA', 'protein').error).toMatch(/bases/)
    expect(cleanReplacement('ATGAAA', 'protein').error).toBeNull()
  })
})
