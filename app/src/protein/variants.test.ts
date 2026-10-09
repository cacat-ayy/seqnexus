import { describe, it, expect } from 'vitest'
import { variantForEdit, mergedDeletion, variantAnnotation, isRecordedVariant, threeLetter } from './variants'

const plain = (i: number) => i + 1

describe('variantForEdit', () => {
  it('names a substitution in the short and the three-letter form', () => {
    const v = variantForEdit('MKVLAAG', 1, 2, 'M', plain)!
    expect(v.kind).toBe('sub')
    expect(v.name).toBe('p.K2M')
    expect(v.hgvs).toBe('p.Lys2Met')
    expect([v.start, v.end]).toEqual([1, 2])
    expect([v.original, v.replacement, v.position]).toEqual(['K', 'M', 2])
  })

  it('writes a stop as * and Ter', () => {
    const v = variantForEdit('MKVL', 2, 3, '*', plain)!
    expect(v.name).toBe('p.V3*')
    expect(v.hgvs).toBe('p.Val3Ter')
  })

  it('names a deletion of one residue and of a range, on the residue that follows', () => {
    const one = variantForEdit('MKVLAAG', 1, 2, '', plain)!
    expect(one.name).toBe('p.K2del')
    expect([one.start, one.end]).toEqual([1, 2])
    const range = variantForEdit('MKVLAAG', 1, 4, '', plain)!
    expect(range.name).toBe('p.K2_L4del')
    expect(range.hgvs).toBe('p.Lys2_Leu4del')
    expect([range.start, range.end]).toEqual([1, 2])
  })

  it('a deletion at the very end marks the residue before it', () => {
    const v = variantForEdit('MKV', 2, 3, '', plain)!
    expect(v.name).toBe('p.V3del')
    expect([v.start, v.end]).toEqual([1, 2])
  })

  it('names an insertion between its neighbours', () => {
    const v = variantForEdit('MKVL', 2, 2, 'AG', plain)!
    expect(v.kind).toBe('ins')
    expect(v.name).toBe('p.K2_V3insAG')
    expect(v.hgvs).toBe('p.Lys2_Val3insAlaGly')
    expect([v.start, v.end]).toEqual([2, 4])
  })

  it('names a replacement of several residues as delins', () => {
    const v = variantForEdit('MKVLAAG', 1, 3, 'RST', plain)!
    expect(v.kind).toBe('delins')
    expect(v.name).toBe('p.K2_V3delinsRST')
    expect(v.hgvs).toBe('p.Lys2_Val3delinsArgSerThr')
    expect([v.start, v.end]).toEqual([1, 4])
  })

  it('uses the displayed numbering', () => {
    const v = variantForEdit('MKVL', 1, 2, 'A', i => i + 25)!
    expect(v.name).toBe('p.K26A')
  })

  it('records nothing for an edit that changes nothing, or one that empties the protein', () => {
    expect(variantForEdit('MKV', 1, 2, 'K', plain)).toBeNull()
    expect(variantForEdit('MKV', 1, 2, 'k', plain)).toBeNull()
    expect(variantForEdit('MKV', 0, 3, '', plain)).toBeNull()
  })
})

describe('mergedDeletion', () => {
  it('joins a Backspace run into one deletion named from the lower position', () => {
    // K2 was deleted first (feature on V, now residue 2); then M1 is deleted.
    const m = mergedDeletion({ original: 'K', position: 2 }, { original: 'M', position: 1 }, 0, 2)
    expect(m.original).toBe('MK')
    expect(m.name).toBe('p.M1_K2del')
    expect([m.start, m.end]).toEqual([0, 1])
  })

  it('joins a Delete-key run in sequence order', () => {
    const m = mergedDeletion({ original: 'K', position: 2 }, { original: 'V', position: 3 }, 1, 2)
    expect(m.original).toBe('KV')
    expect(m.name).toBe('p.K2_V3del')
  })
})

describe('variantAnnotation', () => {
  it('is a variant feature the editor can recognise as its own', () => {
    const a = variantAnnotation(variantForEdit('MKV', 1, 2, 'R', plain)!)
    expect(a.type).toBe('variant')
    expect(a.qualifiers?.note).toEqual(['p.Lys2Arg'])
    expect(isRecordedVariant(a)).toBe(true)
    expect(isRecordedVariant(a, 'sub')).toBe(true)
    expect(isRecordedVariant(a, 'del')).toBe(false)
    expect(isRecordedVariant({ type: 'variant' })).toBe(false)
  })

  it('spells residues in three letters', () => {
    expect(threeLetter('MKV*')).toBe('MetLysValTer')
  })
})
