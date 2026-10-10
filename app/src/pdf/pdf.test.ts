import { describe, it, expect } from 'vitest'
import { unzlibSync } from 'fflate'
import { encodeWinAnsi, encodedWidth, pdfFontFor, pdfMeasure } from './fonts'
import { PdfDocument } from './document'
import { parseColor } from './canvas'
import { planSequencePdf, rangeSegments, renderPdfPage, writeSequencePdf, type SequencePdfOptions, type SequencePdfSource } from './sequence-pdf'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'
import { IntervalTree } from '../models/IntervalTree'
import type { DocumentState } from '../models/Document'
import { getEnzyme } from '../enzymes/db'
import { findAllSites } from '../enzymes/finder'
import { groupCutSites } from '../enzymes/grouping'
import { geneticCode } from '../codon/genetic-codes'
import { buildBasePalette } from '../utils/base-colors'
import { readSequenceColors } from '../components/sequence-paint'

const latin1 = (b: Uint8Array) => Array.from(b, c => String.fromCharCode(c)).join('')

/** Page content streams, inflated. */
function pageContents(bytes: Uint8Array): string[] {
  const out: string[] = []
  const text = latin1(bytes)
  const re = /stream\n/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length
    const lenMatch = /\/Length (\d+)/.exec(text.slice(Math.max(0, m.index - 80), m.index))
    if (!lenMatch) continue
    out.push(latin1(unzlibSync(bytes.subarray(start, start + Number(lenMatch[1])))))
  }
  return out
}

describe('PDF fonts', () => {
  it('spells out Greek letters and keeps Latin-1', () => {
    expect(encodeWinAnsi('β-lactamase')).toBe('beta-lactamase')
    expect(encodeWinAnsi('5 µM, 37 °C')).toBe('5 µM, 37 °C')
    expect(encodeWinAnsi('a→b')).toBe('a?b')
  })

  it('measures with the standard font metrics', () => {
    expect(encodedWidth('F1', 'A', 10)).toBeCloseTo(6.67)
    expect(encodedWidth('F3', 'ACGT', 10)).toBeCloseTo(24)
    expect(encodedWidth('F2', 'a', 1000)).toBe(556)
  })

  it('maps CSS fonts to Courier and Helvetica', () => {
    expect(pdfFontFor('14px "SF Mono", Consolas, monospace')).toEqual({ id: 'F3', size: 14 })
    expect(pdfFontFor('500 11px Inter, sans-serif')).toEqual({ id: 'F1', size: 11 })
    expect(pdfFontFor('600 10px Inter')).toEqual({ id: 'F2', size: 10 })
    expect(pdfFontFor('bold 12px Helvetica')).toEqual({ id: 'F2', size: 12 })
    expect(pdfFontFor('700 12px Menlo, monospace')).toEqual({ id: 'F4', size: 12 })
    expect(pdfMeasure('10px Helvetica', 'AA')).toBeCloseTo(13.34)
  })
})

describe('PDF canvas', () => {
  it('parses the colour forms the painters use', () => {
    expect(parseColor('#ff0000')).toEqual([1, 0, 0, 1])
    expect(parseColor('#0f08')[3]).toBeCloseTo(0.533, 2)
    expect(parseColor('rgba(229,62,62,.08)')[3]).toBeCloseTo(0.08)
    expect(parseColor('rgb(10, 20, 30)')[2]).toBeCloseTo(30 / 255)
  })

  it('merges letters one cell apart into a single run with character spacing', () => {
    const pdf = new PdfDocument()
    const ctx = pdf.addPage()
    ctx.font = '14px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ;['A', 'C', 'G', 'T'].forEach((b, i) => {
      ctx.fillStyle = i % 2 ? '#ff0000' : '#000000'
      ctx.fillText(b, 100 + i * 10, 50)
    })
    const content = ctx.content()
    expect(content.match(/BT/g)).toHaveLength(1)
    // Courier 14px advances 8.4; a 10px cell leaves 1.6 of spacing.
    expect(content).toContain('/Span << /ActualText (ACGT) >> BDC BT')
    expect(content).toContain('ET EMC')
    expect(content).toContain('1.6 Tc')
    expect(content).toContain('(A) Tj 1 0 0 rg (C) Tj 0 0 0 rg (G) Tj 1 0 0 rg (T) Tj')
  })

  it('escapes PDF string delimiters', () => {
    const pdf = new PdfDocument()
    const ctx = pdf.addPage()
    ctx.font = '10px sans-serif'
    ctx.fillText('lac(Z) \\ ori', 0, 0)
    expect(ctx.content()).toContain('(lac\\(Z\\) \\\\ ori) Tj')
  })

  it('writes alpha through ExtGState', () => {
    const pdf = new PdfDocument()
    const ctx = pdf.addPage()
    ctx.globalAlpha = 0.3
    ctx.fillStyle = '#336699'
    ctx.fillRect(0, 0, 10, 10)
    expect(ctx.content()).toContain('/Fa30 gs')
    expect(latin1(pdf.toBytes())).toContain('/Fa30 << /Type /ExtGState /ca 0.3 >>')
  })
})

describe('PDF document', () => {
  it('has a valid cross-reference table', () => {
    const pdf = new PdfDocument({ title: 'pUC19' })
    pdf.addPage().fillRect(10, 10, 100, 100)
    pdf.addPage().fillRect(20, 20, 50, 50)
    const bytes = pdf.toBytes()
    const text = latin1(bytes)
    expect(text.startsWith('%PDF-1.5')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    const xref = Number(/startxref\n(\d+)/.exec(text)![1])
    expect(text.slice(xref, xref + 4)).toBe('xref')
    const entries = text.slice(xref).split('\n').slice(3).filter(l => / n $/.test(l))
    entries.forEach((line, i) => {
      const offset = Number(line.slice(0, 10))
      expect(text.slice(offset, offset + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`))
    })
    expect(text).toContain('/Count 2')
    expect(text).toContain('/Title (pUC19)')
  })
})

describe('sequence PDF', () => {
  const bases = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGGTGAAGGTGATGCTACATACGGAAAGCTTACCCTTAAATTTATTTGCACTACTGGAAAACTACCTGTTCCATGGCCAACACTTGTCACTACTTTCTCTTATGGTGTTCAATGCTTTTCCCGTTATCCGGATCATATGAAACGGCATGACTTTTTCAAGAGTGCCATGCCCGAAGGTTATGTACAGGAACGCACTATATCTTTCAAAGATGACGGGAACTACAAGACGCGTGCTGAAGTCAAGTTTGAAGGTGATACCCTTGTTAATCGTATCGAGTTAAAAGGTATTGATTTTAAAGAAGATGGAAACATTCTCGGACACAAACTCGAGTACAACTATAACTCACACAATGTATACATCACGGCAGACAAACAAAAGAATGGAATCAAAGCTAACTTCAAAATTCGCCACAACATTGAAGATGGATCCGTTCAACTAGCAGACCATTATCAACAAAATACTCCAATTGGCGATGGCCCTGTCCTTTTACCAGACAACCATTACCTGTCGACACAATCTGCCCTTTCGAAAGATCCCAACGAAAAGCGTGACCACATGGTCCTTCTTGAGTTTGTAACTGCTGCTGGGATTACACATGGCATGGATGAGCTCTACAAATAA'
  const gfp = new Annotation({ id: 'gfp', name: 'β-GFP', type: 'CDS', start: 0, end: bases.length, strand: 1, color: '#22c55e' })
  const doc: DocumentState = { name: 'GFP', sequence: new Sequence(bases, 'circular'), annotations: [gfp] }
  const tree = new IntervalTree()
  tree.insert(gfp)
  const sites = findAllSites(bases, ['EcoRI', 'BamHI', 'NcoI'].map(n => getEnzyme(n)!), 'circular')
  const colors = readSequenceColors(document.body)

  const source: SequencePdfSource = {
    doc,
    annTree: tree,
    features: [gfp],
    groupedSites: groupCutSites(sites, false, false),
    primerItemById: new Map(),
    guideItemById: new Map(),
    guidePicks: new Set<string>(),
    autoPicks: new Set(),
    orfPicks: new Set(),
    motifPicks: new Set(),
    graph: null,
    translationFrames: [],
    translationRows: 2,
    translateSelection: false,
    translationCode: geneticCode(1),
    aminoAcidStyle: 'none' as SequencePdfSource['aminoAcidStyle'],
    threeLetter: false,
    basePalette: buildBasePalette('nucleotide', colors.text),
    paintBackground: false,
    showComplement: true,
    showAnnotations: true,
    colors,
    selection: { anchor: 0, caret: 0 },
    search: { query: '', matches: [], currentMatch: -1 } as unknown as SequencePdfSource['search'],
    zoomLevel: 14,
    screenBasesPerRow: 60,
    plasmidScene: null,
  }
  const options: SequencePdfOptions = {
    range: { start: 0, end: bases.length },
    basesPerRow: 60,
    landscape: false,
    header: true,
    highlights: false,
    selectionTranslation: false,
    map: false,
    features: true,
    enzymes: true,
    title: '',
  }

  it('lays out every base once, in lines of the chosen length', () => {
    const plan = planSequencePdf(source, options)
    expect(plan.rows[0]).toEqual([0, 60])
    expect(plan.rows.reduce((n, [s, e]) => n + e - s, 0)).toBe(bases.length)
    expect(plan.letterPt).toBeGreaterThan(5)
    const placed = plan.pages.flat().filter(i => i.kind === 'row')
    expect(placed).toHaveLength(plan.rows.length)
  })

  it('splits a range through the origin into two runs', () => {
    expect(rangeSegments({ start: 700, end: 20 }, 720)).toEqual([[700, 720], [0, 20]])
    const plan = planSequencePdf(source, { ...options, range: { start: 700, end: 20 } })
    expect(plan.rows).toEqual([[700, 720], [0, 20]])
  })

  it('writes the sequence as selectable text, with the tables', async () => {
    const plan = planSequencePdf(source, options)
    const bytes = await writeSequencePdf(plan)
    const pages = pageContents(bytes)
    expect(pages).toHaveLength(plan.pages.length)
    const all = pages.join('\n')
    // The first line's bases as runs of text (colour changes split the Tj).
    const firstLine = [...all.matchAll(/\(([ACGT]+)\) Tj/g)].map(m => m[1]).join('')
    expect(firstLine.startsWith(bases.slice(0, 20))).toBe(true)
    expect(all).toContain('(beta-GFP)')
    expect(all).toContain('(Restriction sites)')
    expect(all).toContain('(BamHI)')
    expect(all).toMatch(/\(Page 1 of \d+\)/)
  })

  it('draws a page onto a plain canvas context for the preview', () => {
    const plan = planSequencePdf(source, options)
    const calls: string[] = []
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k as string] : typeof k === 'string' && k !== 'then' ? () => { calls.push(k); return k === 'measureText' ? { width: 0 } : undefined } : undefined),
      set: (t, k, v) => { t[k as string] = v; return true },
    }) as unknown as CanvasRenderingContext2D
    renderPdfPage(ctx, plan, 0)
    expect(calls).toContain('fillText')
  })
})
