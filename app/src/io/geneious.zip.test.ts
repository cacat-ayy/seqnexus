/**
 * The ZIP side of the Geneious reader. Run in Node, not jsdom: fflate's
 * typed-array checks fail across jsdom's realm.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest'
import { zipSync } from 'fflate'
import { geneiousXml } from './geneious'

const XML = '<geneious><folder name="F" /><geneiousDocument class="x"></geneiousDocument></geneious>'

describe('geneiousXml', () => {
  it('finds the document list among the binary side files', () => {
    const zipped = zipSync({
      'fileData.0': new Uint8Array([0xAC, 0xED, 0, 5]),
      'F.geneious.partial': new TextEncoder().encode(XML),
      'fileData.1': new Uint8Array([0x3C, 0, 0]),
    })
    expect(geneiousXml(zipped.slice().buffer)).toBe(XML)
  })

  it('takes an XML entry under any other name', () => {
    const zipped = zipSync({ 'fileData.0': new Uint8Array([1, 2]), 'documents': new TextEncoder().encode(XML) })
    expect(geneiousXml(zipped.slice().buffer)).toBe(XML)
  })

  it('passes plain XML through', () => {
    expect(geneiousXml(new TextEncoder().encode(XML).slice().buffer)).toBe(XML)
  })

  it('throws on an archive without a document list', () => {
    const zipped = zipSync({ 'fileData.0': new Uint8Array([1, 2]) })
    expect(() => geneiousXml(zipped.slice().buffer)).toThrow('No Geneious document list')
  })
})
