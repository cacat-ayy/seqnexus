import { describe, it, expect } from 'vitest'
import {
  makeDoc, cleanResidues, detectKind, squareUp, residueNumberAt, columnOfResidue,
  sanitizeDoc, docToResult, docFromResult, width, type AlnDoc,
} from './model'
import {
  insertGaps, deleteGaps, slideBlock, slideRoom, eraseBlock, removeBlock, overwrite, insertText,
  insertColumns, deleteColumns, deleteColumnRange, addRows, removeRows, renameRow, moveRows,
  orderRows, setReference, reverseComplementAll, joinRows, concatenate, extractRow, setRowStart,
} from './edit'
import {
  docProfile, profileOf, consensus, consensusAt, columnIdentity, columnSimilarity, columnGaps,
  clustalMark, logoColumn, selectionStats, pairIdentity, identityMatrix, columnsMatching, smooth,
} from './stats'

const origin = { method: 'manual' as const, at: 0 }
function doc(...seqs: string[]): AlnDoc {
  return makeDoc(seqs.map((s, i) => ({ name: `s${i + 1}`, seq: s })), origin)
}
const seqs = (d: AlnDoc) => d.rows.map(r => r.seq)
const ids = (d: AlnDoc, ...i: number[]) => i.map(k => d.rows[k].id)

describe('model', () => {
  it('cleans residues: case, gap spellings, missing data', () => {
    expect(cleanResidues('ac.g~t?', 'dna')).toBe('AC-G-TN')
    expect(cleanResidues('mk?l*', 'protein')).toBe('MKXL*')
    expect(cleanResidues('AC 12\tGT', 'dna')).toBe('ACGT')
  })

  it('detects the kind', () => {
    expect(detectKind(['ACGT-ACGN', 'ACGU'])).toBe('dna')
    expect(detectKind(['MKLVFFAEDVGSNK'])).toBe('protein')
    expect(detectKind(['---'])).toBe('dna')
  })

  it('squares rows up and drops a dead right edge', () => {
    const rows = squareUp([
      { id: 'a', name: 'a', seq: 'AC--' },
      { id: 'b', name: 'b', seq: 'ACG' },
    ])
    expect(rows.map(r => r.seq)).toEqual(['AC-', 'ACG'])
  })

  it('keeps rows it does not need to change', () => {
    const d = doc('ACG', 'ACG')
    expect(squareUp(d.rows)[0]).toBe(d.rows[0])
  })

  it('maps columns to residue numbers, honouring the start', () => {
    const d = doc('-AC-G')
    const row = { ...d.rows[0], start: 100 }
    expect(residueNumberAt(row, 0)).toBeNull()
    expect(residueNumberAt(row, 1)).toBe(100)
    expect(residueNumberAt(row, 4)).toBe(102)
    expect(columnOfResidue(row, 0)).toBe(1)
    expect(columnOfResidue(row, 2)).toBe(4)
    expect(columnOfResidue(row, 3)).toBe(-1)
  })

  it('reads pre-rebuild saved results', () => {
    const d = sanitizeDoc({
      sequences: [
        { name: 'a', alignedBases: 'AC-GT', originalBases: 'ACGT' },
        { name: 'b', alignedBases: 'ACTGT', originalBases: 'ACTGT' },
      ],
      algorithm: 'mafft', consensus: '', conservation: [], score: 0, identity: 0, similarity: 0, gaps: 0, alignmentLength: 5,
    }, { seqType: 'dna', at: 5 })!
    expect(seqs(d)).toEqual(['AC-GT', 'ACTGT'])
    expect(d.origin.method).toBe('mafft')
    expect(d.origin.at).toBe(5)
  })

  it('repairs stored documents', () => {
    const d = sanitizeDoc({
      kind: 'dna',
      rows: [{ id: 'x', name: '', seq: 'acg' }, { id: 'x', name: 'b', seq: 'A' }, { nope: 1 }],
      referenceId: 'gone',
      origin: { method: 'weird' },
    })!
    expect(d.rows).toHaveLength(2)
    expect(d.rows[0].name).toBe('Unnamed')
    expect(d.rows[0].id).not.toBe(d.rows[1].id)
    expect(seqs(d)).toEqual(['ACG', 'A--'])
    expect(d.referenceId).toBeNull()
    expect(d.origin.method).toBe('manual')
    expect(sanitizeDoc(null)).toBeNull()
    expect(sanitizeDoc({ rows: 'no' })).toBeNull()
  })

  it('converts to and from the engine result shape', () => {
    const d = doc('ACGT', 'AC-T', 'ACGA')
    const r = docToResult(d)
    expect(r.alignmentLength).toBe(4)
    expect(r.sequences[1].originalBases).toBe('ACT')
    const back = docFromResult(r, 'dna')
    expect(seqs(back)).toEqual(seqs(d))
  })
})

describe('gap editing', () => {
  it('inserts gaps and pads the other rows', () => {
    const d = doc('ACGT', 'ACGT')
    const e = insertGaps(d, ids(d, 0), 2, 2)
    expect(seqs(e)).toEqual(['AC--GT', 'ACGT--'])
    expect(e.rows[1].id).toBe(d.rows[1].id)
  })

  it('deletes gaps and trims a dead tail', () => {
    const d = doc('AC--GT', 'ACGT--')
    const e = deleteGaps(d, ids(d, 0), 0, 6)
    expect(seqs(e)).toEqual(['ACGT', 'ACGT'])
  })

  it('returns the same document when nothing changes', () => {
    const d = doc('ACGT', 'ACGT')
    expect(deleteGaps(d, ids(d, 0), 0, 4)).toBe(d)
    expect(insertGaps(d, ids(d, 0), 1, 0)).toBe(d)
    expect(eraseBlock(d, [], 0, 2)).toBe(d)
  })

  it('slides a block into neighbouring gaps', () => {
    const d = doc('AC--GT', 'ACGTAA')
    const r0 = ids(d, 0)
    expect(slideRoom(d, r0, 4, 6)).toEqual({ left: 2, right: 0 })
    const left = slideBlock(d, r0, 4, 6, -1)
    expect(left.moved).toBe(-1)
    expect(seqs(left.doc)[0]).toBe('AC-GT-')
    // Asking for more than there is moves as far as it can.
    const far = slideBlock(d, r0, 4, 6, -5)
    expect(far.moved).toBe(-2)
    expect(seqs(far.doc)[0]).toBe('ACGT--')
  })

  it('slides right into gaps, and pushes when allowed', () => {
    const d = doc('AC--GT', 'ACGTAA')
    const r0 = ids(d, 0)
    const right = slideBlock(d, r0, 0, 2, 1)
    expect(seqs(right.doc)[0]).toBe('-AC-GT')
    const blocked = slideBlock(d, r0, 4, 6, 1)
    expect(blocked.moved).toBe(0)
    expect(blocked.doc).toBe(d)
    const pushed = slideBlock(d, r0, 4, 6, 2, true)
    expect(pushed.moved).toBe(2)
    expect(seqs(pushed.doc)).toEqual(['AC----GT', 'ACGTAA--'])
  })

  it('slides several rows together, limited by the tightest', () => {
    const d = doc('A--CG', 'A-CG-')
    const both = ids(d, 0, 1)
    expect(slideRoom(d, both, 3, 4)).toEqual({ left: 0, right: 0 })
    expect(slideRoom(d, both, 1, 1)).toEqual({ left: 0, right: 1 })
    const r = slideBlock(d, both, 0, 1, 1)
    expect(seqs(r.doc)).toEqual(['-A-CG', '-ACG-'])
  })
})

describe('residue editing', () => {
  it('erases to gaps without moving columns', () => {
    const d = doc('ACGT', 'ACGT')
    expect(seqs(eraseBlock(d, ids(d, 1), 1, 3))).toEqual(['ACGT', 'A--T'])
  })

  it('removes a block and pulls the rest left', () => {
    const d = doc('ACGT', 'ACGT')
    expect(seqs(removeBlock(d, ids(d, 1), 1, 3))).toEqual(['ACGT', 'AT--'])
  })

  it('types in overwrite and insert modes', () => {
    const d = doc('ACGT', 'A--T')
    expect(seqs(overwrite(d, d.rows[1].id, 1, 'cg'))).toEqual(['ACGT', 'ACGT'])
    expect(seqs(overwrite(d, d.rows[1].id, 3, 'TT'))).toEqual(['ACGT-', 'A--TT'])
    expect(seqs(insertText(d, d.rows[1].id, 1, 'gg'))).toEqual(['ACGT--', 'AGG--T'])
    expect(overwrite(d, d.rows[1].id, 0, '123')).toBe(d)
  })
})

describe('columns', () => {
  it('inserts and deletes columns', () => {
    const d = doc('ACGT', 'TGCA')
    expect(seqs(insertColumns(d, 2, 1))).toEqual(['AC-GT', 'TG-CA'])
    expect(insertColumns(d, 4, 1)).toBe(d)
    expect(seqs(deleteColumnRange(d, 1, 3))).toEqual(['AT', 'TA'])
    expect(seqs(deleteColumns(d, new Uint8Array([1, 0, 0, 1])))).toEqual(['CG', 'GC'])
  })

  it('finds columns to strip', () => {
    const d = doc('A-CGT-', 'A-CTTA', 'A-CGT-', 'AACGT-')
    expect([...columnsMatching(d, { kind: 'gap-only' })]).toEqual([0, 0, 0, 0, 0, 0])
    expect([...columnsMatching(d, { kind: 'gappy', fraction: 0.75 })]).toEqual([0, 1, 0, 0, 0, 1])
    expect([...columnsMatching(d, { kind: 'invariant' })]).toEqual([1, 0, 1, 0, 1, 0])
    expect([...columnsMatching(d, { kind: 'low-identity', fraction: 0.6 })]).toEqual([0, 1, 0, 1, 0, 1])
    const withGapCol = insertColumns(d, 1, 1)
    const mask = columnsMatching(withGapCol, { kind: 'gap-only' })
    expect(seqs(deleteColumns(withGapCol, mask))).toEqual(seqs(d))
  })
})

describe('rows', () => {
  it('adds, removes, renames and reorders', () => {
    const d = doc('ACGT', 'ACGT', 'ACGT')
    const added = addRows(d, [{ name: ' new ', seq: 'acgtaa' }], 1)
    expect(added.doc.rows.map(r => r.name)).toEqual(['s1', 'new', 's2', 's3'])
    expect(seqs(added.doc)[0]).toBe('ACGT--')
    const removed = removeRows(added.doc, added.ids)
    expect(seqs(removed)).toEqual(['ACGT', 'ACGT', 'ACGT'])
    expect(renameRow(d, d.rows[0].id, '  ').rows[0].name).toBe('s1')
    expect(renameRow(d, d.rows[0].id, 'x').rows[0].name).toBe('x')
    const moved = moveRows(d, ids(d, 2), 0)
    expect(moved.rows.map(r => r.name)).toEqual(['s3', 's1', 's2'])
    expect(moveRows(d, ids(d, 0), 3).rows.map(r => r.name)).toEqual(['s2', 's3', 's1'])
    expect(moveRows(d, ids(d, 0), 0)).toBe(d)
    expect(orderRows(d, ids(d, 1, 0)).rows.map(r => r.name)).toEqual(['s2', 's1', 's3'])
    const numbered = setRowStart(d, d.rows[0].id, 50)
    expect(numbered.rows[0].start).toBe(50)
    expect('start' in setRowStart(numbered, d.rows[0].id, 1).rows[0]).toBe(false)
    expect(setRowStart(d, d.rows[0].id, 1)).toBe(d)
  })

  it('clears the reference when its row goes', () => {
    const d = setReference(doc('A', 'C'), doc('A', 'C').rows[0].id)
    expect(d.referenceId).toBeNull() // a different document's id is refused
    const own = doc('A', 'C')
    const withRef = setReference(own, own.rows[0].id)
    expect(withRef.referenceId).toBe(own.rows[0].id)
    expect(removeRows(withRef, [own.rows[0].id]).referenceId).toBeNull()
  })

  it('reverse-complements every row, keeping gaps', () => {
    const d = makeDoc([{ name: 'a', seq: 'AC-GT', source: { name: 'a' } }, { name: 'b', seq: 'A--TT' }], origin)
    const rc = reverseComplementAll(d)
    expect(seqs(rc)).toEqual(['AC-GT', 'AA--T'])
    expect(rc.rows[0].source?.reversed).toBe(true)
    expect(reverseComplementAll(rc).rows[0].source?.reversed).toBeUndefined()
  })

  it('joins rows, marking disagreements', () => {
    const d = doc('ACG----', '---TTAA', '-CA----')
    const j = joinRows(d, ids(d, 0, 1, 2))
    expect(j.doc.rows).toHaveLength(1)
    expect(j.doc.rows[0].seq).toBe('ACRTTAA')
    expect(j.conflicts).toEqual([2])
    const first = joinRows(d, ids(d, 0, 2), { conflict: 'first', name: 'merged' })
    expect(first.doc.rows.map(r => r.name)).toEqual(['merged', 's2'])
    expect(first.doc.rows[0].seq).toBe('ACG----')
  })

  it('concatenates alignments by name', () => {
    const a = makeDoc([{ name: 'x', seq: 'AC' }, { name: 'y', seq: 'AG' }], origin)
    const b = makeDoc([{ name: 'y', seq: 'TTT' }, { name: 'z', seq: 'GGG' }], origin)
    const c = concatenate(a, b)
    expect(c.rows.map(r => [r.name, r.seq])).toEqual([['x', 'AC---'], ['y', 'AGTTT'], ['z', '--GGG']])
    expect(concatenate(a, b, 'order').rows.map(r => r.seq)).toEqual(['ACTTT', 'AGGGG'])
  })

  it('extracts a row without gaps', () => {
    const d = doc('A-CG-T')
    expect(extractRow(d, d.rows[0].id)).toBe('ACGT')
    expect(extractRow(d, d.rows[0].id, 1, 4)).toBe('CG')
  })
})

describe('statistics', () => {
  it('counts and calls a consensus', () => {
    const d = doc('ACGT', 'ACGA', 'ATG-', 'AT--')
    const p = docProfile(d)
    expect(consensus(p, 'dna')).toBe('AYGW')  // ties become ambiguity codes; an even gap split is not a gap
    expect(consensusAt(p, 3, 'dna', { threshold: 0.75, ignoreGaps: true })).toBe('W')
    expect(consensusAt(p, 1, 'dna', { threshold: 1, ignoreGaps: false })).toBe('Y')
    expect(consensusAt(docProfile(doc('A', '-', '-')), 0, 'dna')).toBe('-')
    expect(consensusAt(docProfile(doc('A', '-', '-')), 0, 'dna', { threshold: 0, ignoreGaps: true })).toBe('A')
  })

  it('protein consensus falls back to X below the threshold', () => {
    const d = makeDoc([{ name: 'a', seq: 'MK' }, { name: 'b', seq: 'ML' }], origin, 'protein')
    expect(consensusAt(docProfile(d), 1, 'protein', { threshold: 0.6, ignoreGaps: true })).toBe('X')
  })

  it('measures identity, similarity and gaps per column', () => {
    const d = doc('AAC', 'AA-', 'AT-')
    const p = docProfile(d)
    const id = columnIdentity(p)
    expect(id[0]).toBeCloseTo(1)
    expect(id[1]).toBeCloseTo(1 / 3)
    expect(id[2]).toBeCloseTo(0) // one residue against two gaps
    expect([...columnGaps(p)].map(v => +v.toFixed(2))).toEqual([0, 0, 0.67])
    const prot = makeDoc([{ name: 'a', seq: 'IL' }, { name: 'b', seq: 'VL' }], origin, 'protein')
    expect(columnIdentity(docProfile(prot))[0]).toBe(0)
    expect(columnSimilarity(docProfile(prot), 'protein')[0]).toBe(1) // I/V are similar
  })

  it('updates the cached profile across small edits', () => {
    const d = doc('ACGT', 'ACGT', 'ACGT', 'ACGT', 'ACGT', 'ACGT')
    docProfile(d)
    const e = overwrite(d, d.rows[2].id, 1, 'T')
    const cached = docProfile(e)
    const fresh = profileOf(e.rows)
    expect([...cached.counts]).toEqual([...fresh.counts])
  })

  it('places Clustal marks', () => {
    const d = makeDoc([{ name: 'a', seq: 'MSIA-' }, { name: 'b', seq: 'MTLG-' }, { name: 'c', seq: 'MAVWA' }], origin, 'protein')
    const p = docProfile(d)
    expect([0, 1, 2, 3, 4].map(c => clustalMark(p, c, 'protein')).join('')).toBe('*::  ')
    const weak = makeDoc([{ name: 'a', seq: 'C' }, { name: 'b', seq: 'S' }, { name: 'c', seq: 'A' }], origin, 'protein')
    expect(clustalMark(docProfile(weak), 0, 'protein')).toBe('.')
  })

  it('builds logo columns', () => {
    const d = doc('A', 'A', 'A', 'A', 'A', 'A', 'A', 'A')
    const col = logoColumn(docProfile(d), 0, 'dna')
    expect(col.bits).toBeCloseTo(2 - 3 / (2 * Math.LN2 * 8))
    expect(col.letters).toEqual([{ ch: 'A', height: col.bits }])
    const mixed = logoColumn(docProfile(doc('A', 'C', 'G', 'T')), 0, 'dna')
    expect(mixed.bits).toBe(0)
    const gappy = logoColumn(docProfile(doc('A', 'A', '-', '-')), 0, 'dna')
    const full = logoColumn(docProfile(doc('A', 'A')), 0, 'dna')
    expect(gappy.bits).toBeCloseTo(full.bits / 2)
  })

  it('summarises a selection', () => {
    const d = doc('ACGTA', 'ACGTT', 'AC-TA', 'TCGTT')
    const all = selectionStats(d)
    expect(all.rows).toBe(4)
    expect(all.columns).toBe(5)
    expect(all.gapCells).toBe(1)
    expect(all.identicalSites).toBe(2) // C and T columns
    expect(all.variableSites).toBe(2)  // A/T at 0 and 4
    expect(all.informativeSites).toBe(1) // only column 4 has two types twice
    expect(all.gc).toBeCloseTo(7 / 19)
    expect(all.lengths).toEqual({ min: 4, max: 5, mean: 4.75 })
    const sub = selectionStats(d, ids(d, 0, 1), 0, 4)
    expect(sub.pairwiseIdentity).toBe(1)
    expect(sub.identicalSites).toBe(4)
    expect(selectionStats(d, ids(d, 0)).pairwiseIdentity).toBeNull()
    // Mean pairwise identity from counts equals the average over all pairs.
    const rows = d.rows
    let sumSame = 0, sumCompared = 0
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      for (let c = 0; c < width(d); c++) {
        const a = rows[i].seq[c], b = rows[j].seq[c]
        if (a === '-' && b === '-') continue
        sumCompared++
        if (a === b) sumSame++
      }
    }
    expect(all.pairwiseIdentity).toBeCloseTo(sumSame / sumCompared)
  })

  it('reports protein similarity', () => {
    const d = makeDoc([{ name: 'a', seq: 'IK' }, { name: 'b', seq: 'VK' }], origin, 'protein')
    const s = selectionStats(d)
    expect(s.pairwiseIdentity).toBe(0.5)
    expect(s.pairwiseSimilarity).toBe(1)
    expect(s.gc).toBeNull()
  })

  it('computes pairwise identity', () => {
    expect(pairIdentity('AC-T', 'AG-T')).toBeCloseTo(2 / 3)
    expect(pairIdentity('--', '--')).toBeNull()
    const m = identityMatrix(doc('ACGT', 'ACGA', 'TTTT').rows)
    expect(m[0 * 3 + 1]).toBeCloseTo(0.75)
    expect(m[1 * 3 + 0]).toBeCloseTo(0.75)
    expect(m[2 * 3 + 2]).toBe(1)
  })

  it('smooths a series', () => {
    expect([...smooth(new Float32Array([0, 3, 0]), 3)]).toEqual([1.5, 1, 1.5])
    const v = new Float32Array([1, 2])
    expect(smooth(v, 1)).toBe(v)
  })
})

describe('origin labels', () => {
  it('names the engine and strategy, or the file format', async () => {
    const { originLabel } = await import('./model')
    expect(originLabel({ method: 'mafft', detail: 'MAFFT L-INS-i', at: 0 })).toBe('MAFFT L-INS-i')
    expect(originLabel({ method: 'kalign', at: 0 })).toBe('Kalign 3')
    expect(originLabel({ method: 'import', format: 'NEXUS', at: 0 })).toBe('NEXUS file')
    expect(originLabel({ method: 'manual', detail: 'Joined alignments', at: 0 })).toBe('Assembled by hand')
  })
})
