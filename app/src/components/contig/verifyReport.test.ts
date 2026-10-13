import { describe, it, expect } from 'vitest'
import { unzlibSync } from 'fflate'
import { verifyReportPdf } from './verifyReport'
import { DEFAULT_VERIFY, verifyClone } from '../../assembly/verify'
import { computeConsensus } from '../../assembly/consensus'
import { testContig, testRow } from '../../assembly/testing'
import type { RefFeature } from '../../assembly/variants'

const REF = 'CCC' + 'ATGAAAGCTTGGTAA' + 'GGGGGG'
const CDS: RefFeature = { id: 'f1', name: 'gfp', type: 'CDS', start: 3, end: 18, strand: 1 }

/** The text drawn on the PDF's pages, from their Flate streams. */
function pageText(bytes: Uint8Array): string {
  const raw = new TextDecoder('latin1').decode(bytes)
  let out = ''
  const re = /stream\n/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length
    const end = raw.indexOf('\nendstream', start)
    try { out += new TextDecoder('latin1').decode(unzlibSync(bytes.slice(start, end))) } catch { /* not a page */ }
  }
  return out
}

describe('verifyReportPdf', () => {
  it('writes the verdict, the features and the differences', () => {
    const doc = testContig([testRow('f', 0, REF.slice(0, 6) + 'G' + REF.slice(7, 20))], REF)
    const r = verifyClone(doc, computeConsensus(doc).bases, [CDS], DEFAULT_VERIFY)!
    const bytes = verifyReportPdf(r, 'Contig 1')
    expect(new TextDecoder('latin1').decode(bytes.slice(0, 8))).toBe('%PDF-1.5')
    const text = pageText(bytes)
    expect(text).toContain('Differences found')
    expect(text).toContain('gfp')
    expect(text).toContain('K2E')
  })
})
