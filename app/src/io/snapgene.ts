/**
 * SnapGene .dna file parser and writer.
 *
 * Parses and produces the binary TLV (type-length-value) packet format
 * used by SnapGene. Handles sequence, topology, strandedness, methylation
 * flags, features, primers, and document name.
 *
 * Format reference: reverse-engineered from Biopython SnapGeneIO,
 * snapgene_reader, and @teselagen/bio-parsers.
 */

import { Sequence, type Topology } from '../models/Sequence'
import { Annotation, type AnnotationData, type Strand } from '../models/Annotation'
import type { DocumentState, SequenceMetadata } from '../models/Document'
import { cleanOligo, newPrimerId, primerOligoFromFeature, type PrimerData } from '../primers/oligo'
import { findBindingSites } from '../primers/binding'
import { resolveForward } from './location'

// Packet type constants
const PACKET_DNA       = 0x00
const PACKET_PRIMERS   = 0x05
const PACKET_NOTES     = 0x06
const PACKET_COOKIE    = 0x09
const PACKET_FEATURES  = 0x0A

let _idPrefix = Math.random().toString(36).slice(2, 6)
let _nextId = 0
function nextId(): string {
  return `sg_${_idPrefix}_${++_nextId}`
}

function resetIds(): void {
  _idPrefix = Math.random().toString(36).slice(2, 6)
  _nextId = 0
}

/**
 * Strip HTML tags from a string and decode entities.
 * SnapGene embeds rich-text HTML in feature names and qualifier values.
 */
function stripHtml(s: string): string {
  if (!s.includes('<')) return s
  // Use DOMParser to extract text content from HTML
  const doc = new DOMParser().parseFromString(s, 'text/html')
  return doc.body.textContent?.trim() || s
}

/** Reset ID counter (for testing). */
export function _resetIdCounter(): void {
  _idPrefix = 'test'
  _nextId = 0
}

/**
 * Parse a SnapGene .dna file from an ArrayBuffer.
 */
export function parseSnapGene(buffer: ArrayBuffer): DocumentState {
  resetIds()
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  let offset = 0

  // --- Validate cookie packet ---
  if (bytes.length < 14) {
    throw new Error('File too small to be a SnapGene file')
  }

  const cookieType = view.getUint8(0)
  if (cookieType !== PACKET_COOKIE) {
    throw new Error(`Expected SnapGene cookie packet (0x09), got 0x${cookieType.toString(16)}`)
  }

  const cookieLen = view.getUint32(1, false) // big-endian
  // Validate magic string "SnapGene"
  const magic = String.fromCharCode(...bytes.slice(5, 13))
  if (magic !== 'SnapGene') {
    throw new Error(`Invalid SnapGene magic: "${magic}"`)
  }

  offset = 5 + cookieLen

  // --- Parse remaining packets ---
  let sequence = ''
  let topology: Topology = 'linear'
  let name = 'Untitled'
  const rawFeatures: RawFeature[] = []
  const rawPrimers: RawPrimer[] = []
  const metadata: SequenceMetadata = {
    strandedness: 'double',
  }

  while (offset < bytes.length) {
    if (offset + 5 > bytes.length) break // not enough room for type + length

    const packetType = view.getUint8(offset)
    const packetLen = view.getUint32(offset + 1, false) // big-endian
    const dataStart = offset + 5
    const dataEnd = dataStart + packetLen

    if (dataEnd > bytes.length) break // truncated packet

    switch (packetType) {
      case PACKET_DNA: {
        // First byte is flags, rest is ASCII sequence
        const flags = view.getUint8(dataStart)
        topology = (flags & 0x01) ? 'circular' : 'linear'
        metadata.strandedness = (flags & 0x02) ? 'double' : 'single'
        metadata.damMethylated = !!(flags & 0x04)
        metadata.dcmMethylated = !!(flags & 0x08)
        metadata.ecoKIMethylated = !!(flags & 0x10)
        // Not String.fromCharCode(...bytes): one argument per base overflows
        // the call stack above about 120 kb.
        sequence = new TextDecoder('latin1').decode(bytes.subarray(dataStart + 1, dataEnd))
        break
      }

      case PACKET_FEATURES: {
        const xml = new TextDecoder().decode(bytes.slice(dataStart, dataEnd))
        parseFeatureXml(xml, rawFeatures)
        break
      }

      case PACKET_NOTES: {
        const xml = new TextDecoder().decode(bytes.slice(dataStart, dataEnd))
        const parsedName = parseNotesXml(xml)
        if (parsedName) name = parsedName
        break
      }

      case PACKET_PRIMERS: {
        const xml = new TextDecoder().decode(bytes.slice(dataStart, dataEnd))
        parsePrimerXml(xml, rawPrimers)
        break
      }

      // Skip unknown packet types
    }

    offset = dataEnd
  }

  if (!sequence) {
    throw new Error('No DNA sequence packet found in SnapGene file')
  }

  const seq = new Sequence(sequence.toUpperCase(), topology)
  const annotations = resolveFeatures(rawFeatures, seq.length, topology === 'circular')
  const primers = resolvePrimers(rawPrimers, seq)
  return {
    name,
    sequence: seq,
    annotations: annotations.map(d => new Annotation(d)),
    ...(primers.length > 0 ? { primers } : {}),
    metadata,
  }
}

// ---------------------------------------------------------------------------
// XML parsers (using DOMParser)
// ---------------------------------------------------------------------------

/** A feature as read, before its segments are turned into a span (that needs the sequence length). */
interface RawFeature {
  data: Omit<AnnotationData, 'start' | 'end'>
  /** 0-based half-open, in the order SnapGene lists them (along the top strand). */
  pieces: [number, number][]
}

function resolveFeatures(raw: RawFeature[], seqLen: number, circular: boolean): AnnotationData[] {
  const out: AnnotationData[] = []
  for (const f of raw) {
    const loc = resolveForward(f.pieces, f.data.strand, seqLen, circular)
    if (!loc) continue
    out.push({
      ...f.data,
      start: loc.start,
      end: loc.end,
      ...(loc.segments ? { segments: loc.segments } : {}),
    })
  }
  return out
}

function parseFeatureXml(xml: string, rawFeatures: RawFeature[]): void {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const features = doc.querySelectorAll('Feature')

  for (const feat of features) {
    const type = feat.getAttribute('type') || 'misc_feature'
    const featName = stripHtml(feat.getAttribute('name') || type)
    const directionality = parseInt(feat.getAttribute('directionality') || '0', 10)

    let strand: Strand = 0
    if (directionality === 1) strand = 1
    else if (directionality === 2) strand = -1

    // Collect all segments. SnapGene uses 1-based inclusive ranges; a range
    // written high-low runs across the origin.
    const pieces: [number, number][] = []
    let color: string | undefined
    for (const seg of feat.querySelectorAll('Segment')) {
      if (seg.getAttribute('type') === 'gap') continue
      const segColor = seg.getAttribute('color')
      if (segColor && !color) color = segColor
      const match = (seg.getAttribute('range') || '').match(/(\d+)-(\d+)/)
      if (match) pieces.push([parseInt(match[1], 10) - 1, parseInt(match[2], 10)])
    }
    if (pieces.length === 0) continue

    // Extract qualifiers
    const qualifiers: Record<string, string[]> = {}
    const qNodes = feat.querySelectorAll('Q')
    for (const q of qNodes) {
      const qName = q.getAttribute('name')
      if (!qName) continue
      const values: string[] = []
      const vNodes = q.querySelectorAll('V')
      for (const v of vNodes) {
        const text = v.getAttribute('text')
        if (text) values.push(stripHtml(text))
      }
      if (values.length > 0) qualifiers[qName] = values
    }

    // Use label qualifier as name if available
    const label = qualifiers['label']?.[0] || qualifiers['gene']?.[0] || qualifiers['product']?.[0]

    rawFeatures.push({
      data: { id: nextId(), name: label || featName, type, strand, color, qualifiers },
      pieces,
    })
  }
}

function parseNotesXml(xml: string): string | null {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')

  // Try CustomMapLabel first (user-set name), then fall back to other fields
  const customLabel = doc.querySelector('CustomMapLabel')
  if (customLabel?.textContent) return stripHtml(customLabel.textContent.trim())

  const accession = doc.querySelector('AccessionNumber')
  if (accession?.textContent) return stripHtml(accession.textContent.trim())

  return null
}

/** A <Primer> as written, before the template is known. */
interface RawPrimer {
  name: string
  /** The full oligo, tails included. Absent in files that only record sites. */
  sequence: string | null
  description: string
  sites: { start: number; end: number; strand: Strand }[]
}

function parsePrimerXml(xml: string, out: RawPrimer[]): void {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  for (const primer of doc.querySelectorAll('Primer')) {
    const sites: RawPrimer['sites'] = []
    for (const site of primer.querySelectorAll('BindingSite')) {
      const match = (site.getAttribute('location') || '').match(/(\d+)-(\d+)/)
      if (!match) continue
      const boundStrand = site.getAttribute('boundStrand')
      sites.push({
        start: parseInt(match[1], 10) - 1, // 1-based → 0-based
        end: parseInt(match[2], 10),
        strand: boundStrand === '0' ? -1 : 1,
      })
    }
    out.push({
      name: stripHtml(primer.getAttribute('name') || 'Primer'),
      sequence: cleanOligo(primer.getAttribute('sequence') || ''),
      description: stripHtml(primer.getAttribute('description') || ''),
      sites,
    })
  }
}

/**
 * Primers as oligos. The recorded sequence is used as is, which is what
 * keeps a tail; binding sites in the file are ignored because they are
 * recomputed from it. A primer written without a sequence falls back to the
 * bases under its first site.
 */
function resolvePrimers(raw: RawPrimer[], template: Sequence): PrimerData[] {
  const primers: PrimerData[] = []
  for (const r of raw) {
    const site = r.sites[0]
    const oligo = r.sequence
      ?? (site ? primerOligoFromFeature({ ...site, qualifiers: {} }, template) : null)
    if (!oligo) continue
    primers.push({
      id: newPrimerId(),
      name: r.name,
      sequence: oligo,
      role: 'primer',
      ...(r.description ? { notes: r.description } : {}),
    })
  }
  return primers
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/** Build a TLV packet: 1-byte type + 4-byte big-endian length + data. */
function makePacket(type: number, data: Uint8Array): Uint8Array {
  const packet = new Uint8Array(5 + data.length)
  packet[0] = type
  const len = data.length
  packet[1] = (len >>> 24) & 0xFF
  packet[2] = (len >>> 16) & 0xFF
  packet[3] = (len >>> 8) & 0xFF
  packet[4] = len & 0xFF
  packet.set(data, 5)
  return packet
}

/** Escape XML special characters. */
function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildCookiePacket(): Uint8Array {
  const payload = new Uint8Array(14)
  const magic = new TextEncoder().encode('SnapGene')
  payload.set(magic, 0)
  // Remaining 6 bytes are zeros (file type / version info)
  return makePacket(PACKET_COOKIE, payload)
}

function buildDnaPacket(state: DocumentState): Uint8Array {
  let flags = 0
  if (state.sequence.topology === 'circular') flags |= 0x01
  if (state.metadata?.strandedness !== 'single') flags |= 0x02 // default double
  if (state.metadata?.damMethylated) flags |= 0x04
  if (state.metadata?.dcmMethylated) flags |= 0x08
  if (state.metadata?.ecoKIMethylated) flags |= 0x10
  const seqBytes = new TextEncoder().encode(state.sequence.bases)
  const payload = new Uint8Array(1 + seqBytes.length)
  payload[0] = flags
  payload.set(seqBytes, 1)
  return makePacket(PACKET_DNA, payload)
}

function buildFeaturesPacket(annotations: Annotation[], seqLen: number): Uint8Array | null {
  const features = annotations.filter(a => a.type !== 'primer_bind')
  if (features.length === 0) return null

  const parts: string[] = ['<Features>']
  for (const ann of features) {
    const dir = ann.strand === 1 ? 1 : ann.strand === -1 ? 2 : 0
    parts.push(`<Feature type="${escXml(ann.type)}" name="${escXml(ann.name)}" directionality="${dir}">`)
    // Segment: 0-based half-open → 1-based inclusive
    const colorAttr = ann.color ? ` color="${escXml(ann.color)}"` : ''
    if (ann.segments) {
      for (const [s, e] of ann.segments) {
        parts.push(`<Segment range="${s + 1}-${e}"${colorAttr} />`)
      }
    } else if (ann.start > ann.end && ann.end > 0) {
      // Origin-spanning: two segments
      parts.push(`<Segment range="${ann.start + 1}-${seqLen}"${colorAttr} />`)
      parts.push(`<Segment range="1-${ann.end}"${colorAttr} />`)
    } else if (ann.start > ann.end && ann.end === 0) {
      parts.push(`<Segment range="${ann.start + 1}-${seqLen}"${colorAttr} />`)
    } else {
      parts.push(`<Segment range="${ann.start + 1}-${ann.end}"${colorAttr} />`)
    }
    // Qualifiers
    const quals = ann.qualifiers ?? {}
    // Always write label
    if (!quals['label']) {
      parts.push(`<Q name="label"><V text="${escXml(ann.name)}" /></Q>`)
    }
    for (const [key, values] of Object.entries(quals)) {
      for (const val of values) {
        parts.push(`<Q name="${escXml(key)}"><V text="${escXml(val)}" /></Q>`)
      }
    }
    parts.push('</Feature>')
  }
  parts.push('</Features>')
  const xml = parts.join('\n')
  return makePacket(PACKET_FEATURES, new TextEncoder().encode(xml))
}

/**
 * The document's primers, plus any `primer_bind` features, as SnapGene
 * primers. SnapGene has no primer feature, so a feature can only survive the
 * trip as a primer; its oligo is whatever it records, or the bases it covers.
 */
function buildPrimersPacket(state: DocumentState): Uint8Array | null {
  const legacy: PrimerData[] = []
  for (const ann of state.annotations) {
    if (ann.type !== 'primer_bind') continue
    const oligo = primerOligoFromFeature(ann, state.sequence)
    if (oligo) legacy.push({ id: ann.id, name: ann.name, sequence: oligo, role: 'primer' })
  }
  const primers = [...(state.primers ?? []), ...legacy]
  if (primers.length === 0) return null

  const sites = findBindingSites(primers, state.sequence.bases, state.sequence.topology)
  const parts: string[] = ['<Primers>']
  for (const p of primers) {
    const desc = p.notes ? ` description="${escXml(p.notes)}"` : ''
    parts.push(`<Primer name="${escXml(p.name)}" sequence="${escXml(p.sequence)}"${desc}>`)
    for (const site of sites.get(p.id) ?? []) {
      // boundStrand: 1 = forward, 0 = reverse
      const boundStrand = site.strand === -1 ? '0' : '1'
      parts.push(`<BindingSite location="${site.start + 1}-${site.end}" boundStrand="${boundStrand}" />`)
    }
    parts.push('</Primer>')
  }
  parts.push('</Primers>')
  const xml = parts.join('\n')
  return makePacket(PACKET_PRIMERS, new TextEncoder().encode(xml))
}

function buildNotesPacket(name: string): Uint8Array {
  const xml = `<Notes><CustomMapLabel>${escXml(name)}</CustomMapLabel></Notes>`
  return makePacket(PACKET_NOTES, new TextEncoder().encode(xml))
}

/**
 * Write a SnapGene .dna file from a DocumentState.
 * Returns an ArrayBuffer containing the binary TLV data.
 */
export function writeSnapGene(state: DocumentState): ArrayBuffer {
  const packets: Uint8Array[] = []

  packets.push(buildCookiePacket())
  packets.push(buildDnaPacket(state))

  const featuresPacket = buildFeaturesPacket(state.annotations, state.sequence.length)
  if (featuresPacket) packets.push(featuresPacket)

  const primersPacket = buildPrimersPacket(state)
  if (primersPacket) packets.push(primersPacket)

  packets.push(buildNotesPacket(state.name))

  // Concatenate all packets
  const totalLen = packets.reduce((sum, p) => sum + p.length, 0)
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const p of packets) {
    result.set(p, offset)
    offset += p.length
  }
  return result.buffer
}
