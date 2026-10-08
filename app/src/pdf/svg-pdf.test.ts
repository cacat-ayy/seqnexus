import { describe, it, expect } from 'vitest'
import { unzlibSync } from 'fflate'
import { svgToPdf, tracePath, parseStyleSheet } from './svg-pdf'
import { writeReportPdf } from './report-pdf'

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

const svg = (body: string, style = '', w = 200, h = 100) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><style>${style}</style>${body}</svg>`

describe('SVG to PDF', () => {
  it('makes one page at the figure size, a pixel being 0.75 pt', () => {
    const bytes = svgToPdf(svg('<rect width="100%" height="100%" fill="#ffffff"/>'), { title: 'Fig 1' })
    const text = latin1(bytes)
    expect(text.startsWith('%PDF-')).toBe(true)
    expect(text).toContain('/MediaBox [0 0 150 75]')
    expect(text).toContain('/Title (Fig 1)')
    expect(pageContents(bytes)[0]).toContain('0 0 200 100 re')
  })

  it('resolves colours as a browser does: a style rule beats an attribute, a class beats a type, inline style beats both', () => {
    const c = pageContents(svgToPdf(svg(
      '<text x="1" y="10" fill="#0000ff">A</text>'
      + '<text x="1" y="20" class="r" fill="#0000ff">B</text>'
      + '<text x="1" y="30" class="r" style="fill:#ffff00">C</text>'
      + '<g fill="#0000ff"><rect x="0" y="40" width="5" height="5"/></g>',
      'text{fill:#00ff00}.r{fill:#ff0000}',
    )))[0]
    const colorBefore = (s: string) => {
      const at = c.indexOf(s)
      const fills = [...c.slice(0, at).matchAll(/([\d.]+ [\d.]+ [\d.]+) rg/g)]
      return fills[fills.length - 1]?.[1]
    }
    expect(colorBefore('(A) Tj')).toBe('0 1 0')
    expect(colorBefore('(B) Tj')).toBe('1 0 0')
    expect(colorBefore('(C) Tj')).toBe('1 1 0')
    expect(colorBefore('0 40 5 5 re')).toBe('0 0 1')
  })

  it('matches descendant selectors and inherits fonts from groups', () => {
    const rules = parseStyleSheet('.r text{font-size:7px}.b,.b text{font-weight:700} a:hover{fill:red}')
    expect(rules.map(r => r.chain.length)).toEqual([2, 1, 2])
    const c = pageContents(svgToPdf(svg(
      '<g class="r"><text x="1" y="10">1</text></g><g class="b"><text x="1" y="20">Bold</text></g><text x="1" y="30">Plain</text>',
      'text{font-family:Helvetica;font-size:10px}' + '.r text{font-size:7px}.b,.b text{font-weight:700}',
    )))[0]
    expect(c).toMatch(/\/F1 7 Tf[^\n]*\(1\) Tj/)
    expect(c).toMatch(/\/F2 10 Tf[^\n]*\(Bold\) Tj/)
    expect(c).toMatch(/\/F1 10 Tf[^\n]*\(Plain\) Tj/)
  })

  it('reads the font shorthand, weight apart from size', () => {
    const c = pageContents(svgToPdf(svg('<text x="1" y="10" class="c">A</text><text x="1" y="30" class="t">Title</text>',
      '.c{font:600 10px Menlo, monospace}.t{font:italic 500 14px/1.2 Helvetica, sans-serif}')))[0]
    expect(c).toMatch(/\/F4 10 Tf[^\n]*\(A\) Tj/)
    expect(c).toMatch(/\/F1 14 Tf[^\n]*\(Title\) Tj/)
  })

  it('sets a glyph at each x of a letter run, as one copyable run in Courier', () => {
    const c = pageContents(svgToPdf(svg('<text x="10 20 30 40" y="10" fill="#000000">ACGT</text>', 'text{font-family:Menlo,monospace;font-size:10px;text-anchor:middle}')))[0]
    expect(c).toContain('/ActualText (ACGT)')
    expect(c).toContain('/F3 10 Tf')
  })

  it('applies opacity, transforms and clip paths', () => {
    const c = pageContents(svgToPdf(svg(
      '<clipPath id="k"><rect x="0" y="0" width="50" height="50"/></clipPath>'
      + '<g clip-path="url(#k)"><path d="M0 0L60 60" stroke="#ff0000" fill="none"/></g>'
      + '<text transform="translate(5 6) scale(2 3)" fill="#000000" opacity="0.5">X</text>',
    )))[0]
    expect(c).toMatch(/0 0 50 50 re\s+W n/)
    expect(c).toMatch(/1 0 0 RG\s+0 0 m 60 60 l\s+S/)
    expect(c).toContain('1 0 0 1 5 6 cm')
    expect(c).toContain('2 0 0 3 0 0 cm')
    expect(latin1(svgToPdf(svg('<rect width="5" height="5" fill="#000000" fill-opacity="0.5"/>')))).toContain('/ca 0.5')
  })

  it('reads path data with relative commands and implicit lines', () => {
    const calls: string[] = []
    const ctx = {
      moveTo: (x: number, y: number) => calls.push(`M${x},${y}`),
      lineTo: (x: number, y: number) => calls.push(`L${x},${y}`),
      bezierCurveTo: (...a: number[]) => calls.push(`C${a.join(',')}`),
      quadraticCurveTo: (...a: number[]) => calls.push(`Q${a.join(',')}`),
      closePath: () => calls.push('Z'),
    }
    tracePath(ctx, 'M10 10h5v5H0zm1 1l2 2 3-3Q1,2 3,4')
    expect(calls).toEqual(['M10,10', 'L15,10', 'L15,15', 'L0,15', 'Z', 'M11,11', 'L13,13', 'L16,10', 'Q1,2,3,4'])
  })

  it('refuses what is not SVG', () => {
    expect(() => svgToPdf('<html></html>')).toThrow()
  })
})

describe('report PDF', () => {
  it('lays out tiles, tables, charts and facts, breaking long tables over pages with their header', () => {
    const rows = Array.from({ length: 120 }, (_, i) => [`contig_${i + 1}`, `${i * 10} bp`, '8.000 bp'])
    const bytes = writeReportPdf({
      title: 'pTest mapping report',
      subtitle: 'reads mapped to pTest',
      blocks: [
        { kind: 'tiles', tiles: [{ label: 'Reads mapped', value: '98.0%', detail: '980 of 1,000' }] },
        { kind: 'heading', text: 'References' },
        { kind: 'table', columns: [{ label: 'Reference' }, { label: 'Length', numeric: true }, { label: 'Size', numeric: true }], rows },
        { kind: 'histogram', title: 'Mapping quality', edges: [0, 10, 20, 30], counts: [5, 0, 50] },
        { kind: 'facts', items: [{ term: 'Mapper', text: 'minimap2 2.22, short reads' }] },
      ],
    })
    const pages = pageContents(bytes)
    expect(pages.length).toBeGreaterThan(1)
    expect(pages[0]).toContain('(pTest mapping report) Tj')
    expect(pages[0]).toContain('(98.0%) Tj')
    // The header again on the next page.
    expect(pages[1]).toContain('(Reference) Tj')
    expect(pages.join('')).toContain('(contig_120) Tj')
    // Cells fit their column whole, not cut with an ellipsis.
    expect(pages.join('')).toContain('(1190 bp) Tj')
    expect(pages[0]).toContain('(8.000 bp) Tj')
    expect(pages.join('')).toContain('(Mapping quality) Tj')
    expect(pages[pages.length - 1]).toContain(`(Page ${pages.length} of ${pages.length}) Tj`)
  })
})
