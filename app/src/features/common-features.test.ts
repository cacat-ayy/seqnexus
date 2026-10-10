import { describe, it, expect } from 'vitest'
import { getCommonFeatures } from './common-features'
import { getScanReferences, builtinSource } from './feature-sources'
import { scanForReferences } from './annotate-scan'
import { translateWith, geneticCode } from '../codon/genetic-codes'

describe('built-in feature library', () => {
  const lib = getCommonFeatures()

  it('has one entry per name and type, since the scan keeps only the first of a pair', () => {
    const keys = lib.map(f => `${f.name}|${f.type}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('names, as a group, an entry of the same type', () => {
    const keys = new Set(lib.map(f => `${f.name}|${f.type}`))
    for (const f of lib.filter(f => f.group)) expect(keys.has(`${f.group}|${f.type}`)).toBe(true)
  })

  it('writes RNA entries in DNA letters, so they are found in the plasmid that encodes them', () => {
    expect(lib.some(f => f.sequence.includes('U'))).toBe(false)
    expect(lib.find(f => f.name === 'Spinach')!.type).toBe('misc_RNA')
  })

  it('types a whole open reading frame as a CDS', () => {
    const code = geneticCode(1)
    const orfs = lib.filter(f => {
      if (f.type === 'CDS' || f.sequence.length < 300 || f.sequence.length % 3) return false
      const aa = translateWith(code, f.sequence)
      return aa.startsWith('M') && aa.endsWith('*') && !aa.slice(0, -1).includes('*')
    })
    expect(orfs.map(f => f.name)).toEqual([])
    for (const name of ['AraC', 'virB4', 'RSF1010 RepA', 'FlpRec']) {
      expect(lib.find(f => f.name === name)!.type).toBe('CDS')
    }
  })

  it('keeps distinct versions of a shared name, such as the pBR322 tet gene and the pUC19 lacZ alpha', () => {
    const tet = lib.find(f => f.name === 'tetR (pBR322)')!
    expect(tet).toMatchObject({ type: 'CDS', group: 'tetR' })
    expect(translateWith(geneticCode(11), tet.sequence).startsWith('MKSNNALIVILGTVTLDAVGIGLVMPVLPGLL')).toBe(true)
    expect(lib.find(f => f.name === 'lacZα (pUC19)')).toMatchObject({ type: 'CDS', group: 'lacZα' })
  })

  it('proposes one feature where a short version lies inside a longer one', () => {
    const long = lib.find(f => f.name === 'rb glob PA')!
    const short = lib.find(f => f.name === 'rb glob PA (short)')!
    expect(long.sequence.length).toBeGreaterThan(short.sequence.length)
    const { references } = getScanReferences([builtinSource()])
    const refs = references.filter(r => r.name === long.name || r.name === short.name)
    expect(refs.find(r => r.name === short.name)!.group).toBe('rb glob PA')
    const flank = 'ACGT'.repeat(40)
    const withLong = scanForReferences({ documentBases: flank + long.sequence + flank, references: refs, minSimilarity: 85, bestMatchOnly: true })
    expect(withLong.map(m => m.refName)).toEqual(['rb glob PA'])
    const withShort = scanForReferences({ documentBases: flank + short.sequence + flank, references: refs, minSimilarity: 85, bestMatchOnly: true })
    expect(withShort.map(m => m.refName)).toEqual(['rb glob PA (short)'])
  })
})
