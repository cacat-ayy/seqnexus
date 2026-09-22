/**
 * Tests for the SnapGene .dna parser and writer.
 *
 * Constructs minimal binary SnapGene files in-memory to test parsing.
 * Round-trip tests verify writeSnapGene → parseSnapGene fidelity.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { parseSnapGene, writeSnapGene, _resetIdCounter } from './snapgene'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'
import type { DocumentState } from '../models/Document'

beforeEach(() => {
  _resetIdCounter()
})

/**
 * Build a minimal SnapGene binary file.
 */
function buildSnapGeneFile(opts: {
  sequence: string
  circular?: boolean
  doubleStranded?: boolean
  dam?: boolean
  dcm?: boolean
  ecoKI?: boolean
  featuresXml?: string
  notesXml?: string
}): ArrayBuffer {
  const parts: Uint8Array[] = []

  // Cookie packet (type 0x09)
  const magic = new TextEncoder().encode('SnapGene')
  const cookiePayload = new Uint8Array(14)
  cookiePayload.set(magic, 0)
  parts.push(makePacket(0x09, cookiePayload))

  // DNA packet (type 0x00)
  let flags = 0
  if (opts.circular) flags |= 0x01
  if (opts.doubleStranded !== false) flags |= 0x02 // default double-stranded
  if (opts.dam) flags |= 0x04
  if (opts.dcm) flags |= 0x08
  if (opts.ecoKI) flags |= 0x10
  const seqBytes = new TextEncoder().encode(opts.sequence)
  const dnaPayload = new Uint8Array(1 + seqBytes.length)
  dnaPayload[0] = flags
  dnaPayload.set(seqBytes, 1)
  parts.push(makePacket(0x00, dnaPayload))

  // Features packet (type 0x0A)
  if (opts.featuresXml) {
    const xmlBytes = new TextEncoder().encode(opts.featuresXml)
    parts.push(makePacket(0x0A, xmlBytes))
  }

  // Notes packet (type 0x06)
  if (opts.notesXml) {
    const xmlBytes = new TextEncoder().encode(opts.notesXml)
    parts.push(makePacket(0x06, xmlBytes))
  }

  // Concatenate all parts
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0)
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result.buffer
}

function makePacket(type: number, data: Uint8Array): Uint8Array {
  const packet = new Uint8Array(5 + data.length)
  packet[0] = type
  // Big-endian length
  const len = data.length
  packet[1] = (len >> 24) & 0xFF
  packet[2] = (len >> 16) & 0xFF
  packet[3] = (len >> 8) & 0xFF
  packet[4] = len & 0xFF
  packet.set(data, 5)
  return packet
}

describe('parseSnapGene', () => {
  it('parses a minimal file with sequence', () => {
    const buf = buildSnapGeneFile({ sequence: 'ATGCGATCGA' })
    const doc = parseSnapGene(buf)
    expect(doc.sequence.bases).toBe('ATGCGATCGA')
    expect(doc.sequence.topology).toBe('linear')
  })

  it('detects circular topology', () => {
    const buf = buildSnapGeneFile({ sequence: 'ATGC', circular: true })
    const doc = parseSnapGene(buf)
    expect(doc.sequence.topology).toBe('circular')
  })

  it('detects single-stranded', () => {
    const buf = buildSnapGeneFile({ sequence: 'ATGC', doubleStranded: false })
    const doc = parseSnapGene(buf)
    expect(doc.metadata?.strandedness).toBe('single')
  })

  it('detects double-stranded', () => {
    const buf = buildSnapGeneFile({ sequence: 'ATGC', doubleStranded: true })
    const doc = parseSnapGene(buf)
    expect(doc.metadata?.strandedness).toBe('double')
  })

  it('detects Dam methylation', () => {
    const buf = buildSnapGeneFile({ sequence: 'ATGC', dam: true })
    const doc = parseSnapGene(buf)
    expect(doc.metadata?.damMethylated).toBe(true)
  })

  it('detects Dcm methylation', () => {
    const buf = buildSnapGeneFile({ sequence: 'ATGC', dcm: true })
    const doc = parseSnapGene(buf)
    expect(doc.metadata?.dcmMethylated).toBe(true)
  })

  it('detects EcoKI methylation', () => {
    const buf = buildSnapGeneFile({ sequence: 'ATGC', ecoKI: true })
    const doc = parseSnapGene(buf)
    expect(doc.metadata?.ecoKIMethylated).toBe(true)
  })

  it('parses features from XML', () => {
    const xml = `<Features>
      <Feature type="CDS" name="lacZ" directionality="1">
        <Segment range="1-100" />
        <Q name="label"><V text="lacZ" /></Q>
      </Feature>
    </Features>`
    const buf = buildSnapGeneFile({ sequence: 'A'.repeat(200), featuresXml: xml })
    const doc = parseSnapGene(buf)
    expect(doc.annotations.length).toBe(1)
    expect(doc.annotations[0].name).toBe('lacZ')
    expect(doc.annotations[0].type).toBe('CDS')
    expect(doc.annotations[0].start).toBe(0)
    expect(doc.annotations[0].end).toBe(100)
    expect(doc.annotations[0].strand).toBe(1)
  })

  it('parses reverse complement features', () => {
    const xml = `<Features>
      <Feature type="promoter" name="pLac" directionality="2">
        <Segment range="50-100" />
      </Feature>
    </Features>`
    const buf = buildSnapGeneFile({ sequence: 'A'.repeat(200), featuresXml: xml })
    const doc = parseSnapGene(buf)
    expect(doc.annotations[0].strand).toBe(-1)
  })

  it('extracts name from notes XML', () => {
    const xml = `<Notes><CustomMapLabel>pUC19</CustomMapLabel></Notes>`
    const buf = buildSnapGeneFile({ sequence: 'ATGC', notesXml: xml })
    const doc = parseSnapGene(buf)
    expect(doc.name).toBe('pUC19')
  })

  it('throws on invalid magic', () => {
    const buf = new ArrayBuffer(20)
    const view = new Uint8Array(buf)
    view[0] = 0x09 // cookie type
    view[1] = 0; view[2] = 0; view[3] = 0; view[4] = 14 // length
    // No "SnapGene" magic
    expect(() => parseSnapGene(buf)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// writeSnapGene tests
// ---------------------------------------------------------------------------

function makeDoc(overrides?: Partial<DocumentState>): DocumentState {
  return {
    name: 'pTest',
    sequence: new Sequence('ATGCGATCGA'),
    annotations: [],
    ...overrides,
  }
}

describe('writeSnapGene', () => {
  beforeEach(() => _resetIdCounter())

  it('produces a buffer that parseSnapGene can read', () => {
    const doc = makeDoc()
    const buf = writeSnapGene(doc)
    expect(buf).toBeInstanceOf(ArrayBuffer)
    expect(buf.byteLength).toBeGreaterThan(0)
    _resetIdCounter()
    const parsed = parseSnapGene(buf)
    expect(parsed.sequence.bases).toBe('ATGCGATCGA')
  })

  it('round-trips sequence and topology', () => {
    const doc = makeDoc({ sequence: new Sequence('GGCCAATTGG', 'circular') })
    const buf = writeSnapGene(doc)
    _resetIdCounter()
    const parsed = parseSnapGene(buf)
    expect(parsed.sequence.bases).toBe('GGCCAATTGG')
    expect(parsed.sequence.topology).toBe('circular')
  })

  it('round-trips strandedness and methylation flags', () => {
    const doc = makeDoc({
      metadata: {
        strandedness: 'single',
        damMethylated: true,
        dcmMethylated: true,
        ecoKIMethylated: true,
      },
    })
    const buf = writeSnapGene(doc)
    _resetIdCounter()
    const parsed = parseSnapGene(buf)
    expect(parsed.metadata?.strandedness).toBe('single')
    expect(parsed.metadata?.damMethylated).toBe(true)
    expect(parsed.metadata?.dcmMethylated).toBe(true)
    expect(parsed.metadata?.ecoKIMethylated).toBe(true)
  })

  it('round-trips document name', () => {
    const doc = makeDoc({ name: 'pUC19-modified' })
    const buf = writeSnapGene(doc)
    _resetIdCounter()
    const parsed = parseSnapGene(buf)
    expect(parsed.name).toBe('pUC19-modified')
  })

  it('round-trips feature annotations', () => {
    const doc = makeDoc({
      sequence: new Sequence('A'.repeat(200)),
      annotations: [
        new Annotation({
          id: 'f1', name: 'GFP', type: 'CDS', start: 10, end: 100,
          strand: 1, color: '#00ff00',
          qualifiers: { product: ['green fluorescent protein'] },
        }),
        new Annotation({
          id: 'f2', name: 'pLac', type: 'promoter', start: 150, end: 180,
          strand: -1,
        }),
      ],
    })
    const buf = writeSnapGene(doc)
    _resetIdCounter()
    const parsed = parseSnapGene(buf)
    expect(parsed.annotations.length).toBe(2)

    const gfp = parsed.annotations.find(a => a.name === 'GFP')!
    expect(gfp.type).toBe('CDS')
    expect(gfp.start).toBe(10)
    expect(gfp.end).toBe(100)
    expect(gfp.strand).toBe(1)
    expect(gfp.color).toBe('#00ff00')
    expect(gfp.qualifiers?.product?.[0]).toBe('green fluorescent protein')

    const plac = parsed.annotations.find(a => a.name === 'pLac')!
    expect(plac.strand).toBe(-1)
  })

  it('round-trips primer annotations in separate packet', () => {
    const doc = makeDoc({
      sequence: new Sequence('A'.repeat(100)),
      annotations: [
        new Annotation({
          id: 'p1', name: 'Fwd-primer', type: 'primer_bind',
          start: 5, end: 25, strand: 1,
        }),
        new Annotation({
          id: 'p2', name: 'Rev-primer', type: 'primer_bind',
          start: 70, end: 90, strand: -1,
        }),
      ],
    })
    const buf = writeSnapGene(doc)
    _resetIdCounter()
    const parsed = parseSnapGene(buf)
    expect(parsed.annotations.length).toBe(2)

    const fwd = parsed.annotations.find(a => a.name === 'Fwd-primer')!
    expect(fwd.type).toBe('primer_bind')
    expect(fwd.start).toBe(5)
    expect(fwd.end).toBe(25)
    expect(fwd.strand).toBe(1)

    const rev = parsed.annotations.find(a => a.name === 'Rev-primer')!
    expect(rev.strand).toBe(-1)
  })

  it('handles mixed features and primers', () => {
    const doc = makeDoc({
      sequence: new Sequence('A'.repeat(200)),
      annotations: [
        new Annotation({ id: 'f1', name: 'GFP', type: 'CDS', start: 10, end: 100, strand: 1 }),
        new Annotation({ id: 'p1', name: 'SeqPrimer', type: 'primer_bind', start: 5, end: 25, strand: 1 }),
      ],
    })
    const buf = writeSnapGene(doc)
    _resetIdCounter()
    const parsed = parseSnapGene(buf)
    expect(parsed.annotations.length).toBe(2)
    expect(parsed.annotations.find(a => a.type === 'CDS')).toBeTruthy()
    expect(parsed.annotations.find(a => a.type === 'primer_bind')).toBeTruthy()
  })

  it('handles empty annotations', () => {
    const doc = makeDoc()
    const buf = writeSnapGene(doc)
    _resetIdCounter()
    const parsed = parseSnapGene(buf)
    expect(parsed.annotations.length).toBe(0)
  })

  it('escapes XML special characters in names', () => {
    const doc = makeDoc({
      name: 'pTest<>&"',
      sequence: new Sequence('A'.repeat(50)),
      annotations: [
        new Annotation({
          id: 'f1', name: 'T7 > promoter & "strong"', type: 'promoter',
          start: 0, end: 20, strand: 1,
        }),
      ],
    })
    const buf = writeSnapGene(doc)
    _resetIdCounter()
    const parsed = parseSnapGene(buf)
    expect(parsed.name).toBe('pTest<>&"')
    expect(parsed.annotations[0].name).toBe('T7 > promoter & "strong"')
  })
})
