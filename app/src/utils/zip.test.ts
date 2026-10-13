import { describe, it, expect } from 'vitest'
import { unzipSync } from 'fflate'
import { zipFiles } from './zip'
import { blobBytes } from './file-credit'

describe('zipFiles', () => {
  it('packs text and bytes under their paths, a second of one name numbered', async () => {
    const zip = zipFiles([
      { path: 'a/pUC19.gb', data: 'LOCUS one' },
      { path: 'a/pUC19.gb', data: 'LOCUS two' },
      { path: 'a/b/x.dna', data: new Uint8Array([9, 8, 7]) },
      { path: 'what?.gb', data: 'q' },
    ])
    const files = unzipSync(await blobBytes(zip))
    const text = (p: string) => new TextDecoder().decode(files[p])
    expect(Object.keys(files).sort()).toEqual(['a/b/x.dna', 'a/pUC19 (2).gb', 'a/pUC19.gb', 'what_.gb'])
    expect(text('a/pUC19.gb')).toBe('LOCUS one')
    expect(text('a/pUC19 (2).gb')).toBe('LOCUS two')
    expect([...files['a/b/x.dna']]).toEqual([9, 8, 7])
  })
})
