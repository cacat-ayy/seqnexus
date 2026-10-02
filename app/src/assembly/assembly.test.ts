import { describe, it, expect } from 'vitest'
import { reverseComplement } from '../models/complement'
import { alignBanded, GLOCAL, OVERLAP } from './align'
import { mapToReference } from './map'
import { assembleDeNovo } from './denovo'
import { computeConsensus, consensusSequence } from './consensus'
import { deleteColumns, insertColumns, removeRows, setCell, stripGapColumns } from './edit'
import { contigToAlignment } from './export'
import { sequenceInput } from './input'
import { testContig, testRow } from './testing'
import { DEFAULT_ASSEMBLY, type AssemblyInput, type ContigDoc } from './types'

function dna(n: number, seed = 1): string {
  let x = seed
  let s = ''
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    s += 'ACGT'[(x >> 16) & 3]
  }
  return s
}

const input = (name: string, seq: string, preferReversed = false): AssemblyInput => ({ ...sequenceInput(name, seq), preferReversed })

/** Every row, ungapped and turned back to forward, is the read it came from. */
function rowsIntact(doc: ContigDoc, inputs: AssemblyInput[]) {
  for (const r of doc.rows) {
    const inp = inputs.find(i => i.name === r.name)!
    const bases = r.seq.replace(/-/g, '')
    expect(r.reversed ? reverseComplement(bases) : bases).toBe(inp.seq)
    expect(r.start + r.seq.length).toBeLessThanOrEqual(doc.width)
    expect(r.src.length).toBe(r.seq.length)
    expect(r.qual.length).toBe(r.seq.length)
  }
}

describe('banded alignment', () => {
  it('aligns a read end to end inside a longer target', () => {
    const target = dna(600)
    const read = target.slice(200, 400)
    const a = alignBanded(read, target, GLOCAL, { lo: 170, hi: 230 })!
    expect(a.tStart).toBe(200)
    expect(a.tEnd).toBe(400)
    expect(a.identity).toBe(1)
    expect(a.ops).toBe('M'.repeat(200))
  })

  it('puts an insertion and a deletion where they are', () => {
    const target = dna(300)
    const read = target.slice(50, 150) + 'G' + target.slice(150, 200) + target.slice(201, 250)
    const a = alignBanded(read, target, GLOCAL, { lo: 20, hi: 80 })!
    expect(a.ops.split('I').length - 1).toBe(1)
    expect(a.ops.split('D').length - 1).toBe(1)
    expect(a.mismatches).toBe(0)
  })

  it('finds an overlap between two reads, with overhangs on both', () => {
    const genome = dna(900, 5)
    const a = genome.slice(0, 600)
    const b = genome.slice(400, 900)
    const aln = alignBanded(b, a, OVERLAP, { lo: 350, hi: 450 })!
    expect(aln.tStart).toBe(400)
    expect(aln.qStart).toBe(0)
    expect(aln.qEnd).toBe(200)
  })
})

describe('mapping to a reference', () => {
  const ref = dna(1500, 11)
  it('places reads on either strand and keeps every base', () => {
    const r1 = ref.slice(100, 700)
    const r2 = reverseComplement(ref.slice(500, 1100))
    // A read with an extra base the reference lacks.
    const r3 = ref.slice(800, 1000) + 'T' + ref.slice(1000, 1300)
    const inputs = [input('r1', r1), input('r2', r2), input('r3', r3)]
    const rep = mapToReference({ name: 'ref', tabId: 't1', bases: ref, circular: false }, inputs, DEFAULT_ASSEMBLY)
    expect(rep.unplaced).toEqual([])
    const doc = rep.contigs[0].doc
    expect(doc.method).toBe('reference')
    expect(doc.rows.map(r => r.reversed)).toEqual([false, true, false])
    // One insertion column for r3's extra base; the reference shows a gap there.
    expect(doc.width).toBe(1501)
    expect(doc.reference!.seq.replace(/-/g, '')).toBe(ref)
    rowsIntact(doc, inputs)
    expect(consensusSequence(computeConsensus(doc))).toBe(ref.slice(100, 1000) + 'T' + ref.slice(1000, 1300))
  })

  it('reports reads that do not match', () => {
    const rep = mapToReference({ name: 'ref', tabId: null, bases: ref, circular: false }, [input('stranger', dna(400, 99))], DEFAULT_ASSEMBLY)
    expect(rep.contigs).toEqual([])
    expect(rep.unplaced[0].reason).toMatch(/No match|identical/)
  })

  it('maps a read across the origin of a circular reference in one piece', () => {
    const plasmid = dna(2000, 21)
    const across = plasmid.slice(1700) + plasmid.slice(0, 300)
    const rep = mapToReference({ name: 'p', tabId: null, bases: plasmid, circular: true }, [input('x', across)], DEFAULT_ASSEMBLY)
    const doc = rep.contigs[0].doc
    expect(doc.rows[0].start).toBe(1700)
    expect(doc.width).toBe(2300)
    expect(doc.reference!.length).toBe(2000)
  })
})

describe('de novo assembly', () => {
  const genome = dna(1600, 31)
  it('joins overlapping reads and turns reverse reads round', () => {
    const inputs = [
      input('a', genome.slice(0, 700)),
      input('b', reverseComplement(genome.slice(500, 1200)), true),
      input('c', genome.slice(1000, 1600)),
    ]
    const rep = assembleDeNovo(inputs, DEFAULT_ASSEMBLY)
    expect(rep.contigs).toHaveLength(1)
    expect(rep.unplaced).toEqual([])
    const doc = rep.contigs[0].doc
    expect(doc.rows.find(r => r.name === 'b')!.reversed).toBe(true)
    rowsIntact(doc, inputs)
    expect(consensusSequence(computeConsensus(doc))).toBe(genome)
  })

  it('keeps unrelated reads apart and reports loners', () => {
    const other = dna(900, 77)
    const inputs = [
      input('a', genome.slice(0, 700)), input('b', genome.slice(600, 1300)),
      input('x', other.slice(0, 500)), input('y', other.slice(400, 900)),
      input('alone', dna(500, 123)),
    ]
    const rep = assembleDeNovo(inputs, DEFAULT_ASSEMBLY)
    expect(rep.contigs).toHaveLength(2)
    expect(rep.unplaced.map(u => u.name)).toEqual(['alone'])
  })

  it('splits similar sequences when the identity bar is high', () => {
    const variant = [...genome.slice(0, 800)].map((c, i) => (i % 40 === 7 ? (c === 'A' ? 'C' : 'A') : c)).join('')
    const inputs = [input('a', genome.slice(0, 800)), input('b', variant)]
    expect(assembleDeNovo(inputs, { ...DEFAULT_ASSEMBLY, minIdentity: 0.9 }).contigs).toHaveLength(1)
    expect(assembleDeNovo(inputs, { ...DEFAULT_ASSEMBLY, minIdentity: 0.99 }).contigs).toHaveLength(0)
  })
})

describe('consensus', () => {
  it('lets a clean read outvote two noisy ones by quality', () => {
    const doc = testContig([
      testRow('good', 0, 'ACGT', { qual: [40, 40, 40, 40] }),
      testRow('bad1', 0, 'ACTT', { qual: [40, 40, 8, 40] }),
      testRow('bad2', 0, 'ACTT', { qual: [40, 40, 9, 40] }),
    ])
    expect(computeConsensus(doc).bases).toBe('ACGT')
    expect(computeConsensus(doc, { method: 'majority', ambiguity: 0 }).bases).toBe('ACTT')
  })

  it('writes an IUPAC code when two bases share the weight', () => {
    const doc = testContig([testRow('a', 0, 'ACGT'), testRow('b', 0, 'ACAT')])
    expect(computeConsensus(doc, { method: 'quality', ambiguity: 0.3 }).bases).toBe('ACRT')
  })

  it('counts coverage and lists disagreements; blank where nothing covers', () => {
    const doc = testContig([testRow('a', 0, 'ACGT'), testRow('b', 6, 'GG')])
    const c = computeConsensus(doc)
    expect(c.bases).toBe('ACGT  GG')
    expect([...c.coverage]).toEqual([1, 1, 1, 1, 0, 0, 1, 1])
    expect(consensusSequence(c)).toBe('ACGTNNGG')
    const d = computeConsensus(testContig([testRow('a', 0, 'ACGT'), testRow('b', 0, 'AGGT'), testRow('c', 0, 'ACGT')]))
    expect(d.disagreements).toEqual([1])
  })
})

describe('contig edits', () => {
  const doc = testContig([testRow('a', 0, 'ACGT'), testRow('b', 2, 'GTAC')], 'ACGTAC')

  it('changes a base and weighs the edit as confident', () => {
    const d = setCell(doc, 'a', 2, 'A')
    expect(d.rows[0].seq).toBe('ACAT')
    expect(d.rows[0].orig).toBe('ACGT')
    // The edited A now outweighs b's G at column 2 only on equal quality; it ties, so both stay visible.
    expect(computeConsensus(d).disagreements).toContain(2)
    expect(setCell(doc, 'a', 9, 'A')).toBe(doc)
  })

  it('inserts and deletes columns through every row and the reference', () => {
    const d = insertColumns(doc, 3, 2)
    expect(d.width).toBe(8)
    expect(d.reference!.seq).toBe('ACG--TAC')
    expect(d.rows[0].seq).toBe('ACG--T')
    expect(d.rows[1]).toMatchObject({ start: 2, seq: 'G--TAC' })
    const back = deleteColumns(d, 3, 5)
    expect(back.rows.map(r => r.seq)).toEqual(['ACGT', 'GTAC'])
    expect(back.reference!.seq).toBe('ACGTAC')
    // Reference bases are never deleted.
    expect(deleteColumns(doc, 0, 2)).toBe(doc)
  })

  it('removes reads and the columns only they used', () => {
    const d = insertColumns(doc, 6, 1)
    const withExtra = setCell({ ...d, rows: d.rows.map(r => (r.id === 'b' ? { ...r, seq: r.seq + '-', orig: r.orig + '-', src: [...r.src, -1], qual: [...r.qual, 0] } : r)) }, 'b', 6, 'T')
    const gone = removeRows(withExtra, ['b'])
    expect(gone.rows.map(r => r.id)).toEqual(['a'])
    expect(gone.width).toBe(6)
    expect(stripGapColumns(gone)).toBe(gone)
  })

  it('exports as an alignment with the reference first and as reference', () => {
    const aln = contigToAlignment(doc, 'test')
    expect(aln.rows.map(r => r.name)).toEqual(['pUC19', 'test consensus', 'a', 'b'])
    expect(aln.rows.map(r => r.seq)).toEqual(['ACGTAC', 'ACGTAC', 'ACGT--', '--GTAC'])
    expect(aln.referenceId).toBe(aln.rows[0].id)
  })
})
