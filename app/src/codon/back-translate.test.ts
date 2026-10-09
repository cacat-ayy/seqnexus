import { describe, it, expect } from 'vitest'
import { backTranslate } from './back-translate'
import { geneticCode, translateWith } from './genetic-codes'
import { BUILTIN_USAGE_TABLES } from './usage-tables'

const code = geneticCode(1)
const table = BUILTIN_USAGE_TABLES[0]

describe('backTranslate', () => {
  it('gives every residue the codon its host uses most, and translates back to itself', () => {
    const r = backTranslate('MKVLAAGIVGLLLAAQPAMA', code, table)
    expect(r.bases.length).toBe(60)
    expect(translateWith(code, r.bases)).toBe('MKVLAAGIVGLLLAAQPAMA')
    expect(r.unencodable).toEqual([])
    // The same residue always gets the same codon.
    const codons = r.bases.match(/.{3}/g)!
    const forA = new Set('MKVLAAGIVGLLLAAQPAMA'.split('').map((aa, i) => (aa === 'A' ? codons[i] : null)).filter(Boolean))
    expect(forA.size).toBe(1)
  })

  it('resolves B, Z and J, keeps a stop, and names what it cannot encode', () => {
    const r = backTranslate('BZJ*X', code, table)
    expect(translateWith(code, r.bases)).toBe('DEI*')
    expect(r.unencodable).toEqual(['X'])
  })
})
