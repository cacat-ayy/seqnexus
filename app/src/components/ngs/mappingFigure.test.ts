import { describe, expect, it } from 'vitest'
import { buildMappingFigure, MAX_READ_SPAN, type MappingFigureInput } from './mappingFigure'
import { layoutReads, viewRead } from '../../ngs/view'
import { storeAlignment } from '../../ngs/alignments'
import { parseSamLine } from '../../ngs/mapper'

const REF = 'ACGTACGTAAGGCCTTACGTACGTAAGGCCTTACGTACGTAAGGCCTT' // 48 bp
const read = (name: string, pos: number, seq: string, flag = 0) =>
  viewRead(storeAlignment({ bases: REF, circular: false }, parseSamLine(`${name}\t${flag}\tref\t${pos + 1}\t60\t${seq.length}M\t*\t0\t0\t${seq}\t*`, () => 0), 0), 0)

function input(): MappingFigureInput {
  const alt = REF.slice(4, 10) + 'T' + REF.slice(11, 24)
  const layout = layoutReads([read('a', 4, alt), read('b', 20, REF.slice(20, 40), 16)], { softClips: false, downsample: null, minMapq: 0, gap: 1, maxRows: 10 })
  return {
    refIndex: 0, refName: 'pTest', length: REF.length, circular: false, bases: REF,
    coverage: Uint32Array.from({ length: REF.length }, (_, i) => (i >= 4 && i < 40 ? 1 : 0)), levels: [], pileup: null,
    opts: { colorBy: 'strand', softClips: false, strands: false, lowCoverage: 0, brush: null, expected: null },
    layout, variants: null,
  }
}

const opts = { from: 0, to: REF.length, width: 480, tracks: { ruler: true, coverage: true, variants: true, reference: true, reads: true }, maxRows: 10, coverageHeight: 40, strands: false, colorBy: 'strand' as const }

describe('mapping figure', () => {
  it('draws the tracks as SVG on white, with reads, their mismatch and the reference bases', () => {
    const f = buildMappingFigure(input(), { ...opts, title: 'Clone <7>' })
    expect(f.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(f.svg).toContain('fill="#ffffff"')
    expect(f.svg).toContain('Clone &lt;7&gt;')
    expect(f.svg).toContain('>Coverage<')
    expect(f.svg).toContain('>Reads<')
    expect(f.svg).not.toMatch(/rgba\(/)
    // The two reads, and the T read where the reference has G (at 10 px per base).
    expect((f.svg.match(/height="7"/g) ?? []).length).toBeGreaterThanOrEqual(3)
    // Ten pixels a base: the reference is written out as letters.
    expect(f.svg).toContain('class="b"')
    expect(f.width).toBe(96 + 480 + 12)
  })

  it('leaves the reads out of a stretch too long to tell them apart', () => {
    const big = { ...input(), length: MAX_READ_SPAN * 3 }
    const f = buildMappingFigure(big, { ...opts, to: MAX_READ_SPAN * 2, tracks: { ...opts.tracks, reference: false } })
    expect(f.svg).toContain('Reads are drawn for stretches of')
  })
})
