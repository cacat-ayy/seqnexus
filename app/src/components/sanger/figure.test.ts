import { describe, it, expect } from 'vitest'
import type { TraceData } from '../../io/trace'
import { buildTraceModel } from '../../sanger/model'
import { DEFAULT_TRACE_VIEW } from '../../sanger/view'
import { buildTraceFigure } from './figure'

function read(bases: string): TraceData {
  const len = bases.length * 10 + 10
  const ch = () => Array.from({ length: len }, (_, i) => (i % 10 === 0 ? 500 : 20))
  return {
    name: 'r', bases, peakLocations: [...bases].map((_, i) => 10 + i * 10),
    qualityScores: new Array(bases.length).fill(35), traces: { A: ch(), C: ch(), G: ch(), T: ch() }, metadata: {},
  }
}

describe('trace figure', () => {
  const m = buildTraceModel(read('ACGT'.repeat(30)), [], 0, 120, false)
  const opts = { d0: 0, d1: 120, perLine: 50, fontSize: 10, traceHeight: 80, ruler: true, quality: true, showTrim: false }

  it('draws a row per line with a path per channel and every call', () => {
    const fig = buildTraceFigure(m, DEFAULT_TRACE_VIEW, opts)
    expect(fig.svg.startsWith('<svg')).toBe(true)
    expect(fig.svg.match(/<clipPath /g)).toHaveLength(3)
    expect(fig.svg.match(/<path /g)).toHaveLength(12)
    expect(fig.svg.match(/class="c"/g)).toHaveLength(120)
  })

  it('leaves hidden channels out and escapes the title', () => {
    const view = { ...DEFAULT_TRACE_VIEW, channels: { A: true, C: false, G: false, T: false } }
    const fig = buildTraceFigure(m, view, { ...opts, perLine: 0, title: 'pUC <M13F>' })
    expect(fig.svg.match(/<path /g)).toHaveLength(1)
    expect(fig.svg).toContain('pUC &lt;M13F&gt;')
  })
})

describe('trace figure as PDF', () => {
  it('draws the four traces inside their clip, and every call', async () => {
    const { svgToPdf } = await import('../../pdf/svg-pdf')
    const { unzlibSync } = await import('fflate')
    const m = buildTraceModel(read('ACGT'.repeat(30)), [], 0, 120, false)
    const fig = buildTraceFigure(m, DEFAULT_TRACE_VIEW, { d0: 0, d1: 120, perLine: 50, fontSize: 10, traceHeight: 80, ruler: true, quality: true, showTrim: false })
    const bytes = svgToPdf(fig.svg)
    const text = Array.from(bytes, c => String.fromCharCode(c)).join('')
    const at = text.indexOf('stream\n') + 7
    const content = Array.from(unzlibSync(bytes.subarray(at, at + Number(/\/Length (\d+)/.exec(text)![1]))), c => String.fromCharCode(c)).join('')
    expect(content.match(/W n/g)).toHaveLength(3)
    // Twelve trace paths (four channels, three rows), stroked with round joins.
    expect(content.match(/ l\nS/g)?.length).toBeGreaterThanOrEqual(12)
    expect(content).toContain('1 j')
    // The calls at the figure's font size, bold monospace.
    expect(content).toContain('/F4 10 Tf')
    expect(content).not.toMatch(/\/F\d [1-9]\d\d+ Tf/)
    expect(content.match(/\/ActualText \(([ACGT]+)\)/g)?.join('').replace(/\/ActualText \(|\)/g, '')).toBe('ACGT'.repeat(30))
  })
})
