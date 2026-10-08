import { describe, it, expect } from 'vitest'
import { reverseComplement } from '../models/complement'
import { assembleDeNovo } from './denovo'
import { mapToReference } from './map'
import { clipColumns, cutRow, extendedTrim, placeRead, replaceRow, rowCalledRange, rowClips } from './place'
import { DEFAULT_ASSEMBLY, type AssemblyInput, type ContigDoc } from './types'
import { computeConsensus, consensusSequence } from './consensus'

function dna(n: number, seed = 1): string {
  let x = seed
  let s = ''
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    s += 'ACGT'[(x >> 16) & 3]
  }
  return s
}

/** A read of `bases`, trimmed to called bases [a, b): src counts from the read's first base. */
function read(name: string, bases: string, a = 0, b = bases.length): AssemblyInput {
  const seq = bases.slice(a, b)
  return { readId: name, name, seq, qual: new Array(seq.length).fill(40), src: Array.from({ length: seq.length }, (_, i) => a + i), preferReversed: false }
}

const REF = dna(900, 21)
const refOf = (bases = REF, circular = false) => ({ name: 'ref', tabId: null, bases, circular })
const consensusOf = (doc: ContigDoc) => consensusSequence(computeConsensus(doc, { method: 'quality', ambiguity: 0 }))

describe('trimmed ends of a row', () => {
  // A read of reference bases 100-400, trimmed to its bases 50-250 (reference 150-350).
  const raw = REF.slice(100, 400)
  const doc = mapToReference(refOf(), [read('a', raw, 50, 250)], DEFAULT_ASSEMBLY).contigs[0].doc
  const row = doc.rows[0]

  it('finds the bases outside the trim, and where to show them', () => {
    expect(rowCalledRange(row)).toEqual([50, 249])
    const clips = rowClips(row, read('a', raw))!
    expect(clips.left.map(c => c.ch).join('')).toBe(raw.slice(0, 50))
    expect(clips.right.map(c => c.ch).join('')).toBe(raw.slice(250))
    const cols = clipColumns(doc, row, clips)
    expect(cols.left[0].col).toBe(100)
    expect(cols.right[0].col).toBe(350)
    expect(cols.right).toHaveLength(50)
  })

  it('flips them for a reversed row', () => {
    const rdoc = mapToReference(refOf(), [read('r', reverseComplement(raw), 50, 250)], DEFAULT_ASSEMBLY).contigs[0].doc
    const r = rdoc.rows[0]
    expect(r.reversed).toBe(true)
    const clips = rowClips(r, read('r', reverseComplement(raw)))!
    // Shown on the reference's strand, the read's own end comes first.
    expect(clips.left.map(c => c.ch).join('')).toBe(raw.slice(0, 50))
    expect(clips.right.map(c => c.ch).join('')).toBe(raw.slice(250))
  })

  it('extends the trim to a trimmed-off base, keeping the other end', () => {
    expect(extendedTrim(row, 10)).toEqual([10, 250])
    expect(extendedTrim(row, 280)).toEqual([50, 281])
    expect(extendedTrim(row, -1)).toBeNull()
  })

  it('shows trimmed ends past the contig\'s edges', () => {
    // Trimmed to its bases 50-250, the read starts at the reference's base 1: 50 bases stick out.
    const edge = mapToReference(refOf(), [read('e', 'ACGTACGTAC'.repeat(5) + REF.slice(0, 250), 50, 250)], DEFAULT_ASSEMBLY).contigs[0].doc
    const cols = clipColumns(edge, edge.rows[0], rowClips(edge.rows[0], read('e', 'ACGTACGTAC'.repeat(5) + REF.slice(0, 250)))!)
    expect(cols.left[0].col).toBe(-50)
    expect(cols.left[49].col).toBe(-1)
  })
})

describe('placing a read again with a new trim', () => {
  const rawA = REF.slice(100, 400)
  const rawB = REF.slice(300, 700)
  const doc = mapToReference(refOf(), [read('a', rawA, 50, 250), read('b', rawB, 0, 400)], DEFAULT_ASSEMBLY).contigs[0].doc

  it('extends the row in place, leaving the other rows alone', () => {
    const before = consensusOf(doc)
    const r = replaceRow(doc, doc.rows[0].id, read('a', rawA), DEFAULT_ASSEMBLY)
    expect('doc' in r).toBe(true)
    const after = (r as { doc: ContigDoc }).doc
    expect(after.rows.map(x => x.id)).toEqual(doc.rows.map(x => x.id))
    expect(after.rows[0].start).toBe(100)
    expect(after.rows[0].seq).toBe(rawA)
    expect(after.rows[1]).toEqual(doc.rows[1])
    expect(after.reference?.seq).toBe(doc.reference?.seq)
    expect(consensusOf(after)).toBe(REF.slice(100, 700))
    expect(before).toBe(REF.slice(150, 700))
  })

  it('cuts a row back in place, keeping its edits', () => {
    const b = doc.rows[1]
    // An edit at column 360, which only this read covers.
    const x = REF[360] === 'A' ? 'C' : 'A'
    const edited = { ...doc, rows: [doc.rows[0], { ...b, seq: b.seq.slice(0, 60) + x + b.seq.slice(61) }] }
    // Keep up to and including column 499 (reference base 500).
    const cut = cutRow(edited, b.id, 499, 'to')!
    expect(cut.rows[1].seq).toBe(edited.rows[1].seq.slice(0, 200))
    expect(cut.rows[1].seq[60]).toBe(x)
    expect(cut.rows[1].start).toBe(300)
    expect(consensusOf(cut)).toBe(REF.slice(150, 360) + x + REF.slice(361, 500))
    // From column 400 on: the row now starts there.
    const from = cutRow(doc, b.id, 400, 'from')!
    expect(from.rows[1].start).toBe(400)
    expect(from.rows[1].seq).toBe(REF.slice(400, 700))
    expect(cutRow(doc, b.id, 50, 'to')).toBeNull()
  })

  it('refuses an end that does not match, saying how well it matched', () => {
    const junk = rawA.slice(0, 250) + dna(200, 5)
    const r = replaceRow(doc, doc.rows[0].id, read('a', junk), DEFAULT_ASSEMBLY)
    expect(r).toEqual({ reason: expect.stringMatching(/^Only \d+% identical to the reference \(needs 80%\)$/) })
  })

  it('keeps a reversed row reversed', () => {
    const rdoc = mapToReference(refOf(), [read('r', reverseComplement(rawA), 50, 250)], DEFAULT_ASSEMBLY).contigs[0].doc
    const r = replaceRow(rdoc, rdoc.rows[0].id, read('r', reverseComplement(rawA)), DEFAULT_ASSEMBLY) as { doc: ContigDoc }
    expect(r.doc.rows[0].reversed).toBe(true)
    expect(r.doc.rows[0].seq).toBe(rawA)
    expect(r.doc.rows[0].start).toBe(100)
  })

  it('takes in a read with an insertion, adding a column', () => {
    const withIns = REF.slice(300, 500) + 'TTT' + REF.slice(500, 700)
    const r = placeRead(doc, read('c', withIns), DEFAULT_ASSEMBLY, 'row9')
    const placed = (r as { doc: ContigDoc }).doc
    expect(placed.width).toBe(doc.width + 3)
    expect(placed.reference?.seq.replace(/-/g, '')).toBe(REF)
    expect(placed.rows.find(x => x.id === 'row9')?.seq.replace(/-/g, '')).toBe(withIns)
  })

  it('lets a read run past the origin of a circular reference', () => {
    const plasmid = dna(1200, 8)
    const across = plasmid.slice(1000) + plasmid.slice(0, 200)
    const cdoc = mapToReference(refOf(plasmid, true), [read('x', across, 0, 150)], DEFAULT_ASSEMBLY).contigs[0].doc
    const r = replaceRow(cdoc, cdoc.rows[0].id, read('x', across), DEFAULT_ASSEMBLY) as { doc: ContigDoc }
    expect(r.doc.rows[0].seq).toBe(across)
    expect(r.doc.rows[0].start).toBe(1000)
  })
})

describe('placing again de novo', () => {
  const genome = dna(1000, 33)
  const f = genome.slice(0, 600)
  const rv = reverseComplement(genome.slice(400, 1000))
  const doc = assembleDeNovo([read('f', f, 0, 500), read('r', rv)], { ...DEFAULT_ASSEMBLY, minIdentity: 0.9 }).contigs[0].doc

  it('extends a row into what the other reads cover', () => {
    const fRow = doc.rows.find(r => r.name === 'f')!
    const r = replaceRow(doc, fRow.id, read('f', f), { ...DEFAULT_ASSEMBLY, minIdentity: 0.9 }) as { doc: ContigDoc }
    // De novo, the contig may be laid out on either strand.
    const row = r.doc.rows.find(x => x.name === 'f')!
    const bases = row.seq.replace(/-/g, '')
    expect(row.reversed ? reverseComplement(bases) : bases).toBe(f)
    expect([genome, reverseComplement(genome)]).toContain(consensusOf(r.doc))
  })

  it('refuses an end that lines up with nothing in the contig', () => {
    const fRow = doc.rows.find(r => r.name === 'f')!
    const junk = f.slice(0, 500) + dna(100, 2)
    const r = replaceRow(doc, fRow.id, read('f', junk), { ...DEFAULT_ASSEMBLY, minIdentity: 0.9 })
    expect('reason' in r).toBe(true)
  })
})
