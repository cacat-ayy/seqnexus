/**
 * Property tests for the sequence writers: what a writer puts in a file must
 * read back as what went in.
 *
 * `parse(write(x))` is compared with `x` field by field over random
 * sequences, random feature spans (origin-crossing and reverse ones
 * included) and random qualifier strings, 2,000 cases per writer. The
 * generators stay inside what each format can carry, and what a format
 * cannot carry is asserted here as an explicit, named loss rather than left
 * for a reader to discover (see the Export formats section of the README).
 *
 * Deliberate, documented losses, asserted below so they cannot drift:
 *  - GenBank, GenPept and EMBL: a strandless feature (strand 0) comes back
 *    as forward, the flat file having no way to say "no strand"; the
 *    sequence comes back upper case; a name with spaces survives only when
 *    there is no description to put it in.
 *  - GFF3: the description is not carried.
 *  - SnapGene: a qualifier with an empty value is dropped.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { parseGenBank, writeGenBank } from './genbank'
import { parseEmbl, writeEmbl } from './embl'
import { readFasta, writeFastaRecord } from './fasta'
import { parseSnapGene, writeSnapGene } from './snapgene'
import { gff3Documents, readGff3, writeGff3 } from './gff3'
import { Sequence, type Topology } from '../models/Sequence'
import { Annotation, type AnnotationData, type Strand } from '../models/Annotation'
import type { DocumentState } from '../models/Document'

const RUNS = 2000

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Bases a nucleotide format must carry: ACGT plus the IUPAC ambiguity codes. */
const basesOf = (n: number) => fc.stringMatching(new RegExp(`^[ACGTRYSWKMBDHVN]{${n}}$`))

/**
 * Text a qualifier value may hold. Printable ASCII minus the characters the
 * flat-file formats use as syntax, plus the quote (which is doubled) and a
 * few non-ASCII letters, so the escaping is exercised rather than avoided.
 * No leading or trailing space: a wrapped value is rejoined on spaces, so
 * only the inner text can survive a round trip.
 */
const TEXT_CHARS = `[A-Za-z0-9 "'_.,;:=&()[\\]{}+*#@!?/\\\\|<>äöüÄÖÜéèñ-]`
const qualifierText = fc.stringMatching(new RegExp(`^[A-Za-z0-9]${TEXT_CHARS}{0,119}$`))
  .map(s => s.replace(/\s+/g, ' ').trimEnd())

/** A feature name: the same text, but one that survives being used as a /label. */
const featureName = qualifierText

const FEATURE_TYPES = ['CDS', 'gene', 'misc_feature', 'promoter', 'terminator', 'rep_origin', 'mRNA', 'exon', 'intron'] as const

/** A span on a sequence of `len` bases; `circular` also produces origin-crossing spans. */
const spanOf = (len: number, circular: boolean) =>
  fc.tuple(fc.integer({ min: 0, max: len - 1 }), fc.integer({ min: 1, max: Math.min(len, 60) }))
    .map(([start, size]): [number, number] => {
      const end = start + size
      if (end <= len) return [start, end]
      return circular ? [start, end - len] : [len - size, len]
    })
    .filter(([s, e]) => (circular ? s !== e : s < e))

const annotationOf = (len: number, circular: boolean, i: number) =>
  fc.record({
    span: spanOf(len, circular),
    name: featureName,
    type: fc.constantFrom(...FEATURE_TYPES),
    strand: fc.constantFrom<Strand>(1, -1),
    quals: fc.dictionary(
      fc.constantFrom('note', 'product', 'gene', 'function', 'standard_name'),
      fc.array(qualifierText, { minLength: 1, maxLength: 2 }),
      { maxKeys: 3 },
    ),
  }).map(({ span, name, type, strand, quals }): AnnotationData => ({
    id: `f${i}`, name, type, start: span[0], end: span[1], strand, qualifiers: quals,
  }))

interface DocOpts {
  circular?: boolean
  /** Protein documents have no topology and no primers. */
  protein?: boolean
  maxFeatures?: number
}

const docArb = (opts: DocOpts = {}) =>
  fc.integer({ min: 1, max: 400 }).chain(len =>
    fc.record({
      name: fc.stringMatching(/^[A-Za-z0-9_.-]{1,24}$/),
      description: fc.option(qualifierText, { nil: undefined }),
      bases: opts.protein
        ? fc.stringMatching(new RegExp(`^[ACDEFGHIKLMNPQRSTVWY]{${len}}$`))
        : basesOf(len),
      topology: opts.protein ? fc.constant<Topology>('linear') : fc.constant<Topology>(opts.circular ? 'circular' : 'linear'),
      annotations: fc.array(
        fc.integer({ min: 0, max: 99 }).chain(i => annotationOf(len, !opts.protein && !!opts.circular, i)),
        { maxLength: opts.maxFeatures ?? 6 },
      ),
    }).filter(({ name, description }) =>
      // A description that is the name again is the documented exception
      // (genbank.writer.test.ts pins it): with no description the writer
      // puts the name in DEFINITION, so the two write the same file.
      !description || (description !== name && description.replace(/\s+/g, '_') !== name),
    ).map(({ name, description, bases, topology, annotations }): DocumentState => ({
      name,
      description,
      sequence: new Sequence(bases, topology, opts.protein ? 'protein' : 'dna'),
      // Ids must be distinct for GFF3, whose reader groups the parts of one feature by ID.
      annotations: annotations.map((a, i) => new Annotation({ ...a, id: `f${i}` })),
    })),
  )

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** A feature as the formats can carry it: the span, the strand, the name, the type, the qualifiers. */
const featureView = (a: Annotation, opts: { strandless?: boolean } = {}) => ({
  name: a.name,
  type: a.type,
  start: a.start,
  end: a.end,
  strand: opts.strandless ? (a.strand === -1 ? -1 : 1) : a.strand,
  qualifiers: Object.fromEntries(
    Object.entries(a.qualifiers).filter(([k]) => k !== 'label').map(([k, v]) => [k, [...v]]),
  ),
})

const sorted = (fs: readonly Annotation[], opts?: { strandless?: boolean }) =>
  fs.map(f => featureView(f, opts))
    .sort((x, y) => x.start - y.start || x.end - y.end || x.name.localeCompare(y.name) || x.type.localeCompare(y.type))

// ---------------------------------------------------------------------------
// The writers
// ---------------------------------------------------------------------------

describe('writer property: GenBank', () => {
  it('a record reads back with its sequence, topology, features and qualifiers', () => {
    fc.assert(fc.property(fc.boolean().chain(c => docArb({ circular: c })), doc => {
      const back = parseGenBank(writeGenBank(doc))
      expect(back.sequence.bases).toBe(doc.sequence.bases.toUpperCase())
      expect(back.sequence.topology).toBe(doc.sequence.topology)
      expect(sorted(back.annotations)).toEqual(sorted(doc.annotations))
      // The name survives in full; when there is a description it is kept
      // apart. A description that is the name again is the one exception:
      // with no description the writer puts the name in DEFINITION, so the
      // two cases write the same file and it reads back as the name alone.
      expect(back.name).toBe(doc.name)
      if (doc.description) expect(back.description).toBe(doc.description)
      else expect(back.description).toBeUndefined()
    }), { numRuns: RUNS })
  })

  it('every line fits the 79 columns the GenBank release notes describe', () => {
    fc.assert(fc.property(docArb({ circular: true }), doc => {
      for (const line of writeGenBank(doc).split('\n')) expect(line.length).toBeLessThanOrEqual(79)
    }), { numRuns: RUNS })
  })
})

describe('writer property: GenPept', () => {
  it('a protein reads back with its residues and features', () => {
    fc.assert(fc.property(docArb({ protein: true }), doc => {
      const back = parseGenBank(writeGenBank(doc))
      expect(back.sequence.bases).toBe(doc.sequence.bases.toUpperCase())
      expect(back.sequence.alphabet).toBe('protein')
      expect(sorted(back.annotations)).toEqual(sorted(doc.annotations))
    }), { numRuns: RUNS })
  })
})

describe('writer property: EMBL', () => {
  it('a record reads back with its sequence, topology, features and qualifiers', () => {
    fc.assert(fc.property(fc.boolean().chain(c => docArb({ circular: c })), doc => {
      const back = parseEmbl(writeEmbl(doc))[0]
      expect(back.sequence.bases).toBe(doc.sequence.bases.toUpperCase())
      expect(back.sequence.topology).toBe(doc.sequence.topology)
      expect(sorted(back.annotations)).toEqual(sorted(doc.annotations))
    }), { numRuns: RUNS })
  })

  it('the SQ line counts the bases the sequence lines hold', () => {
    fc.assert(fc.property(docArb({ circular: true }), doc => {
      const text = writeEmbl(doc)
      const sq = text.split('\n').find(l => l.startsWith('SQ   '))!
      const m = /^SQ {3}Sequence (\d+) BP; (\d+) A; (\d+) C; (\d+) G; (\d+) T; (\d+) other;$/.exec(sq)
      expect(m).not.toBeNull()
      const s = doc.sequence.bases.toUpperCase()
      const count = (ch: string) => [...s].filter(c => c === ch).length
      expect(m!.slice(1).map(Number)).toEqual([
        s.length, count('A'), count('C'), count('G'), count('T'),
        s.length - count('A') - count('C') - count('G') - count('T'),
      ])
      for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(80)
    }), { numRuns: RUNS })
  })
})

describe('writer property: FASTA', () => {
  it('the sequence, the name and the description read back', () => {
    fc.assert(fc.property(docArb(), doc => {
      const text = writeFastaRecord(doc.name, doc.sequence.bases, doc.description)
      const rec = readFasta(text, 'x').records[0]
      expect(rec.bases).toBe(doc.sequence.bases.toUpperCase())
      expect(rec.name).toBe(doc.name)
      expect(rec.description ?? '').toBe(doc.description ?? '')
    }), { numRuns: RUNS })
  })
})

describe('writer property: SnapGene', () => {
  it('a record reads back with its sequence, topology and features', () => {
    fc.assert(fc.property(fc.boolean().chain(c => docArb({ circular: c })), doc => {
      const back = parseSnapGene(writeSnapGene(doc))
      expect(back.sequence.bases).toBe(doc.sequence.bases.toUpperCase())
      expect(back.sequence.topology).toBe(doc.sequence.topology)
      expect(sorted(back.annotations)).toEqual(sorted(doc.annotations))
      expect(back.name).toBe(doc.name)
    }), { numRuns: RUNS })
  })
})

describe('writer property: GFF3 with sequence', () => {
  it('a record reads back with its sequence, topology and features', () => {
    fc.assert(fc.property(fc.boolean().chain(c => docArb({ circular: c })), doc => {
      const back = gff3Documents(readGff3(writeGff3(doc, { withSequence: true })))[0]
      expect(back.sequence.bases).toBe(doc.sequence.bases.toUpperCase())
      expect(back.sequence.topology).toBe(doc.sequence.topology)
      expect(sorted(back.annotations)).toEqual(sorted(doc.annotations))
    }), { numRuns: RUNS })
  })

  it('every line has nine tab-separated columns and escapes what column 9 reserves', () => {
    fc.assert(fc.property(docArb({ circular: true }), doc => {
      for (const line of writeGff3(doc, { withSequence: false }).split('\n')) {
        if (!line || line.startsWith('#')) continue
        const cols = line.split('\t')
        expect(cols).toHaveLength(9)
        // Sequence Ontology GFF3: ; = & , tab, newline, CR and % must be
        // percent-encoded in column 9. Several values of one qualifier are
        // one comma-separated list, so each item is checked on its own.
        const seen = new Set<string>()
        for (const pair of cols[8].split(';')) {
          expect(pair).toMatch(/^[^=]+=/)
          const tag = pair.slice(0, pair.indexOf('='))
          expect(seen.has(tag)).toBe(false)
          seen.add(tag)
          for (const value of pair.slice(pair.indexOf('=') + 1).split(',')) {
            expect(value).not.toMatch(/[\t\n\r;=&,]/)
            expect(value).not.toMatch(/%(?![0-9A-Fa-f]{2})/)
            expect(value).not.toBe('')
          }
        }
        // The seqid is restricted further than a value (GFF3, column 1).
        expect(cols[0]).toMatch(/^[a-zA-Z0-9.:^*$@!+_?|%-]+$/)
      }
    }), { numRuns: RUNS })
  })
})
