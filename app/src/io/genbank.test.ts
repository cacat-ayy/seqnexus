import { describe, it, expect, beforeEach } from 'vitest'
import { parseGenBank, writeGenBank, _resetIdCounter } from './genbank'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'
import { DocumentState } from '../models/Document'
import { reverseComplement } from '../models/complement'

beforeEach(() => {
  _resetIdCounter()
})

const SAMPLE_GB = `LOCUS       pUC19                   2686 bp    DNA     circular   01-JAN-2000
DEFINITION  pUC19 cloning vector.
FEATURES             Location/Qualifiers
     CDS             1..100
                     /label="lacZ"
                     /gene="lacZ"
     promoter        complement(200..250)
                     /label="lac promoter"
ORIGIN
        1 atgcgatcga atgcgatcga atgcgatcga atgcgatcga atgcgatcga atgcgatcga
       61 atgcgatcga atgcgatcga atgcgatcga atgcgatcga
//
`

describe('parseGenBank', () => {
  it('parses LOCUS name and topology', () => {
    const doc = parseGenBank(SAMPLE_GB)
    expect(doc.name).toBe('pUC19')
    expect(doc.sequence.topology).toBe('circular')
  })

  it('parses sequence from ORIGIN', () => {
    const doc = parseGenBank(SAMPLE_GB)
    expect(doc.sequence.length).toBe(100)
    expect(doc.sequence.bases.slice(0, 10)).toBe('ATGCGATCGA')
  })

  it('parses features with correct coordinates', () => {
    const doc = parseGenBank(SAMPLE_GB)
    expect(doc.annotations).toHaveLength(2)

    const cds = doc.annotations[0]
    expect(cds.type).toBe('CDS')
    expect(cds.name).toBe('lacZ')
    expect(cds.start).toBe(0)   // 1-based 1 → 0-based 0
    expect(cds.end).toBe(100)   // 1-based inclusive 100 → half-open 100
    expect(cds.strand).toBe(1)
  })

  it('parses complement features', () => {
    const doc = parseGenBank(SAMPLE_GB)
    const prom = doc.annotations[1]
    expect(prom.type).toBe('promoter')
    expect(prom.name).toBe('lac promoter')
    expect(prom.strand).toBe(-1)
    expect(prom.start).toBe(199)  // 1-based 200 → 0-based 199
    expect(prom.end).toBe(250)
  })

  it('parses qualifiers', () => {
    const doc = parseGenBank(SAMPLE_GB)
    const cds = doc.annotations[0]
    expect(cds.qualifiers['gene']).toEqual(['lacZ'])
    expect(cds.qualifiers['label']).toEqual(['lacZ'])
  })

  it('handles linear topology', () => {
    const linear = SAMPLE_GB.replace('circular', 'linear')
    const doc = parseGenBank(linear)
    expect(doc.sequence.topology).toBe('linear')
  })

  it('handles missing topology (defaults to linear)', () => {
    const noTopo = `LOCUS       pTest                    50 bp    DNA             01-JAN-2000
ORIGIN
        1 atgcgatcga atgcgatcga atgcgatcga atgcgatcga atgcgatcga
//
`
    const doc = parseGenBank(noTopo)
    expect(doc.sequence.topology).toBe('linear')
  })
})

describe('writeGenBank', () => {
  it('produces valid GenBank output', () => {
    const doc: DocumentState = {
      name: 'pTest',
      sequence: new Sequence('ATGCGATCGA', 'circular'),
      annotations: [
        new Annotation({
          id: 'f1', name: 'GFP', type: 'CDS',
          start: 0, end: 9, strand: 1,
        }),
      ],
    }

    const output = writeGenBank(doc)
    expect(output).toContain('LOCUS')
    expect(output).toContain('pTest')
    expect(output).toContain('circular')
    expect(output).toContain('CDS')
    expect(output).toContain('/label="GFP"')
    expect(output).toContain('ORIGIN')
    expect(output).toContain('atgcgatcga')
    expect(output).toContain('//')
  })

  it('writes complement for reverse strand', () => {
    const doc: DocumentState = {
      name: 'pTest',
      sequence: new Sequence('ATGCGATCGA'),
      annotations: [
        new Annotation({
          id: 'f1', name: 'Kan', type: 'gene',
          start: 2, end: 8, strand: -1,
        }),
      ],
    }

    const output = writeGenBank(doc)
    expect(output).toContain('complement(3..8)')
  })

  it('formats sequence in 60-char lines with 10-char groups', () => {
    const bases = 'A'.repeat(75)
    const doc: DocumentState = {
      name: 'pTest',
      sequence: new Sequence(bases),
      annotations: [],
    }

    const output = writeGenBank(doc)
    const originIdx = output.indexOf('ORIGIN')
    const seqSection = output.slice(originIdx + 7, output.indexOf('//'))
    const seqLines = seqSection.trim().split('\n')
    expect(seqLines).toHaveLength(2)
    // First line: 60 bases in 6 groups of 10
    expect(seqLines[0].trim().split(/\s+/).length).toBe(7) // number + 6 groups
  })
})

describe('round-trip', () => {
  it('parse → write → parse preserves data', () => {
    const doc1 = parseGenBank(SAMPLE_GB)
    const written = writeGenBank(doc1)
    _resetIdCounter()
    const doc2 = parseGenBank(written)

    expect(doc2.name).toBe(doc1.name)
    expect(doc2.sequence.bases).toBe(doc1.sequence.bases)
    expect(doc2.sequence.topology).toBe(doc1.sequence.topology)
    expect(doc2.annotations).toHaveLength(doc1.annotations.length)

    for (let i = 0; i < doc1.annotations.length; i++) {
      expect(doc2.annotations[i].type).toBe(doc1.annotations[i].type)
      expect(doc2.annotations[i].name).toBe(doc1.annotations[i].name)
      expect(doc2.annotations[i].start).toBe(doc1.annotations[i].start)
      expect(doc2.annotations[i].end).toBe(doc1.annotations[i].end)
      expect(doc2.annotations[i].strand).toBe(doc1.annotations[i].strand)
    }
  })
})

describe('primers', () => {
  /** 300 bp with no long repeats. */
  const BASES = (() => {
    let x = 3
    let s = ''
    for (let i = 0; i < 300; i++) {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5
      s += 'ACGT'[(x >>> 7) & 3]
    }
    return s
  })()

  const doc = (primers: DocumentState['primers'], topology: 'linear' | 'circular' = 'linear'): DocumentState => ({
    name: 'pTest', sequence: new Sequence(BASES, topology), annotations: [], primers,
  })

  it('writes a primer as primer_bind over the annealed part, with the whole oligo', () => {
    // Ending the tail in BASES[120] guarantees it cannot pair there (its
    // complement would have to equal itself), so the site stops at 120.
    const oligo = 'GGATCCA' + BASES[120] + reverseComplement(BASES.slice(100, 120))
    const out = writeGenBank(doc([{ id: 'o1', name: 'BamHI-rev', sequence: oligo, role: 'primer' }]))
    expect(out).toContain('primer_bind     complement(101..120)')
    expect(out).toContain(`/primer_sequence="${oligo}"`)
  })

  it('round-trips a tailed primer and a probe', () => {
    const fwd = 'GAATTCAA' + BASES.slice(20, 40)
    const probe = BASES.slice(150, 175)
    const written = writeGenBank(doc([
      { id: 'o1', name: 'EcoRI-fwd', sequence: fwd, role: 'primer', notes: 'adds EcoRI' },
      { id: 'o2', name: 'TaqMan', sequence: probe, role: 'probe' },
    ]))
    const back = parseGenBank(written)
    expect(back.annotations).toHaveLength(0)
    expect(back.primers?.map(p => [p.name, p.sequence, p.role, p.notes])).toEqual([
      ['EcoRI-fwd', fwd, 'primer', 'adds EcoRI'],
      ['TaqMan', probe, 'probe', undefined],
    ])
  })

  it('reads a primer written at two sites back as one primer', () => {
    const repeat = BASES.slice(50, 72)
    const d = { ...doc([{ id: 'o1', name: 'Twice', sequence: repeat, role: 'primer' as const }]) }
    d.sequence = new Sequence(BASES + repeat)
    const written = writeGenBank(d)
    expect(written.match(/primer_bind/g)).toHaveLength(2)
    expect(parseGenBank(written).primers).toHaveLength(1)
  })

  it('leaves a primer_bind from elsewhere as a feature', () => {
    const gb = SAMPLE_GB.replace('     promoter        complement(200..250)', '     primer_bind     complement(200..220)')
    const parsed = parseGenBank(gb)
    expect(parsed.primers).toBeUndefined()
    expect(parsed.annotations.map(a => a.type)).toContain('primer_bind')
  })
})
