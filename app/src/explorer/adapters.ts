/**
 * Per-kind adapters: the only code that knows what distinguishes a contig
 * from a chromatogram.
 *
 * Everything downstream of here (rows, grouping, selection, the context menu)
 * works on `ExplorerItem` and never branches on kind again.
 */

import { Lock, TriangleAlert, Globe, FlaskConical, Wand2, Activity, TestTube, Link2, Scissors, Atom, Database, Crosshair } from 'lucide-react'
import type { LibraryOligo } from '../primers/oligo'
import { oligoTm } from '../primers/display'
import type {
  DocumentTab, SequencingRead, ReadSet, SavedAlignment, Assembly, Contig, GelDoc, CloneDoc,
} from '../store'
import type { DocumentOrigin } from '../models/Document'
import type { ExplorerItem, ItemBadge, ItemKind } from './types'
import { documentKind, toUid } from './types'
import { formatPercent, formatCount, meanQuality } from './format'
import { formatBp, formatAa } from '../utils/format'
import { readQc } from '../sanger/qc'
import { METHOD_LABEL, partMatchesSource } from '../cloning/design'
import { originLabel } from '../msa/model'
import { summarize } from '../msa/stats'
import { readSetQc } from '../ngs/qc'
import { readCountLabel, readShape, technologyLabel } from '../ngs/format'

/**
 * What the centre panel is actually showing.
 *
 * The store keeps five independent `active*Id` values at once, so "active"
 * alone cannot tell you which row the main view corresponds to. App resolves
 * them in a fixed precedence; this mirrors it so exactly one row can read as
 * open.
 */
export interface OpenTarget {
  kind: ItemKind
  id: string | null
}

export interface AdapterContext {
  open: OpenTarget
  /** Reads drawn alongside the open one in the multi-trace view. */
  includedReadIds: readonly string[]
  /** For naming the reference of a read alignment or contig. */
  tabNameById: ReadonlyMap<string, string>
  /** Library oligos that bind the open sequence, and its name. */
  oligosBindingOpen?: ReadonlySet<string>
  /**
   * The sequence behind each open tab, for telling whether a cloning
   * design's copy of a part still matches the sequence it came from.
   */
  tabSequenceById?: ReadonlyMap<string, { bases: string; topology: 'linear' | 'circular' }>
  openSequenceName?: string
}

const READ_ONLY_BADGE: ItemBadge = {
  key: 'read-only', label: 'Read only', icon: Lock, tone: 'neutral',
}

/**
 * Badges for where a document came from.
 *
 * Only the origins worth distinguishing at a glance get one. A plain file
 * import is the default and stays unmarked, or every row would carry a badge
 * and none of them would mean anything.
 */
const ORIGIN_BADGE: Partial<Record<NonNullable<DocumentOrigin>, ItemBadge>> = {
  ncbi: { key: 'origin', label: 'Fetched from NCBI', icon: Globe, tone: 'neutral' },
  cloning: { key: 'origin', label: 'Cloning product', icon: FlaskConical, tone: 'neutral' },
  pcr: { key: 'origin', label: 'PCR product', icon: TestTube, tone: 'neutral' },
  gel: { key: 'origin', label: 'Extracted from a gel', icon: Scissors, tone: 'neutral' },
  optimized: { key: 'origin', label: 'Codon optimized', icon: Wand2, tone: 'neutral' },
  consensus: { key: 'origin', label: 'Called from a trace', icon: Activity, tone: 'neutral' },
  translation: { key: 'origin', label: 'Translated from DNA', icon: Atom, tone: 'neutral' },
  uniprot: { key: 'origin', label: 'Fetched from UniProt', icon: Database, tone: 'neutral' },
  edited: { key: 'origin', label: 'Edited in silico', icon: Crosshair, tone: 'neutral' },
}

/**
 * A library oligo. It is never "open"; the useful fact about it is whether
 * it binds the sequence that is, which is what the badge says.
 */
export function oligoToItem(oligo: LibraryOligo, ctx: AdapterContext): ExplorerItem {
  const badges: ItemBadge[] = []
  if (ctx.oligosBindingOpen?.has(oligo.id)) {
    badges.push({ key: 'binds', label: `Binds ${ctx.openSequenceName ?? 'the open sequence'}`, icon: Link2, tone: 'neutral' })
  }
  const stats = [`${oligo.sequence.length} nt`, `Tm ${oligoTm(oligo.sequence).toFixed(1)}°`]
  if (oligo.role === 'probe') stats.push('probe')
  return {
    uid: toUid('oligo', oligo.id),
    kind: 'oligo',
    id: oligo.id,
    name: oligo.name,
    createdAt: oligo.createdAt,
    size: oligo.sequence.length,
    isOpen: false,
    isIncluded: false,
    isDirty: false,
    isReadOnly: false,
    isCircular: false,
    canDuplicate: false,
    stats,
    badges,
    derivedFrom: [],
  }
}

function isOpen(ctx: AdapterContext, kind: ItemKind, id: string): boolean {
  return ctx.open.kind === kind && ctx.open.id === id
}

/** A document tab: a DNA sequence, or a protein, which is its own kind here. */
export function sequenceToItem(tab: DocumentTab, ctx: AdapterContext): ExplorerItem {
  const circular = tab.doc.sequence.topology === 'circular'
  const protein = tab.doc.sequence.alphabet === 'protein'
  const kind = documentKind(tab.doc.sequence.alphabet)
  const features = tab.doc.annotations.length

  const badges: ItemBadge[] = []
  const originBadge = tab.doc.metadata?.origin && ORIGIN_BADGE[tab.doc.metadata.origin]
  if (originBadge) badges.push(originBadge)
  if (tab.readOnly) badges.push(READ_ONLY_BADGE)

  return {
    uid: toUid(kind, tab.id),
    kind,
    id: tab.id,
    name: tab.doc.name,
    createdAt: tab.createdAt,
    modifiedAt: tab.modifiedAt,
    size: tab.doc.sequence.length,
    isOpen: isOpen(ctx, kind, tab.id),
    isIncluded: false,
    isDirty: tab.undoStack.length > 0,
    isReadOnly: tab.readOnly,
    isCircular: circular,
    canDuplicate: true,
    // A protein is always linear, so saying so would be noise.
    stats: protein
      ? [formatAa(tab.doc.sequence.length), formatCount(features, 'feature')]
      : [formatBp(tab.doc.sequence.length), circular ? 'circular' : 'linear', formatCount(features, 'feature')],
    badges,
    // A translated protein nests under the DNA it came from.
    derivedFrom: tab.doc.metadata?.translatedFrom ? [toUid('sequence', tab.doc.metadata.translatedFrom.tabId)] : [],
  }
}

export function readToItem(read: SequencingRead, ctx: AdapterContext): ExplorerItem {
  const total = read.data.bases.length
  // `trimEnd` is an absolute index into the read, not a count back from the
  // end: `addSequencingRead` initialises it to `bases.length`, and
  // ChromatogramView slices `[trimStart, trimEnd)`.
  const end = Math.min(read.trimEnd, total)
  const start = Math.min(read.trimStart, end)
  const trimmed = end - start
  const isTrimmed = start > 0 || end < total

  // Averaged over the kept window, not the whole read. The untrimmed tails
  // are exactly the low-quality part, so a whole-read mean would drag every
  // read down and fire the low-quality badge on all of them.
  // A file without qualities has a track of zeros; that is no quality, not Q0.
  const q = read.data.metadata.qualityMissing ? null : meanQuality(read.data.qualityScores.slice(start, end))

  const stats = [isTrimmed ? `${formatBp(trimmed)} of ${formatBp(total)}` : formatBp(total)]
  if (q !== null) stats.push(`Q${Math.round(q)}`)

  // The verdict is about the trace itself, so it does not move with the trim.
  const badges: ItemBadge[] = []
  const qc = readQc(read.data)
  if (qc.verdict !== 'good') {
    badges.push({
      key: qc.verdict === 'fail' ? 'qc-fail' : 'qc-check',
      label: `${qc.verdict === 'fail' ? 'Failed read' : 'Check read'}: ${qc.issues[0]}`,
      icon: TriangleAlert,
      tone: qc.verdict === 'fail' ? 'danger' : 'warn',
    })
  }

  return {
    uid: toUid('read', read.id),
    kind: 'read',
    id: read.id,
    name: read.data.name,
    createdAt: read.createdAt,
    size: trimmed,
    isOpen: isOpen(ctx, 'read', read.id),
    // The open read is also in the multi-trace list; only the others need
    // the secondary marker, or every single-read view would show both states.
    isIncluded: ctx.includedReadIds.includes(read.id) && !isOpen(ctx, 'read', read.id),
    isDirty: read.edits.length > 0,
    isReadOnly: false,
    isCircular: false,
    canDuplicate: false,
    stats,
    badges,
    derivedFrom: [],
  }
}

/** A read set: reads (or pairs), their shape, the technology, and its QC verdict. */
export function readSetToItem(rs: ReadSet, ctx: AdapterContext): ExplorerItem {
  const badges: ItemBadge[] = []
  const qc = readSetQc(rs.stats, rs.technology)
  if (qc.verdict !== 'good') {
    badges.push({
      key: qc.verdict === 'fail' ? 'qc-fail' : 'qc-check',
      label: `${qc.verdict === 'fail' ? 'Failed QC' : 'Check QC'}: ${qc.issues[0]}`,
      icon: TriangleAlert,
      tone: qc.verdict === 'fail' ? 'danger' : 'warn',
    })
  }
  if (rs.origin) badges.push({ key: 'origin', label: `Trimmed from ${rs.origin.fromName}`, icon: Scissors, tone: 'neutral' })
  return {
    uid: toUid('readset', rs.id),
    kind: 'readset',
    id: rs.id,
    name: rs.name,
    createdAt: rs.createdAt,
    modifiedAt: rs.modifiedAt,
    size: rs.stats.bases,
    isOpen: isOpen(ctx, 'readset', rs.id),
    isIncluded: false,
    isDirty: false,
    isReadOnly: false,
    isCircular: false,
    canDuplicate: false,
    stats: [readCountLabel(rs), readShape(rs), technologyLabel(rs), ...(rs.discardedAt ? ['reads discarded'] : [])],
    badges,
    derivedFrom: [],
  }
}

export function alignmentToItem(align: SavedAlignment, ctx: AdapterContext): ExplorerItem {
  const summary = summarize(align.doc)
  const stats = [formatCount(summary.rows, 'sequence')]
  if (summary.identity !== null) stats.push(`${formatPercent(summary.identity)} identity`)
  stats.push(originLabel(align.doc.origin))
  return {
    uid: toUid('alignment', align.id),
    kind: 'alignment',
    id: align.id,
    name: align.name,
    createdAt: align.createdAt,
    size: summary.width,
    isOpen: isOpen(ctx, 'alignment', align.id),
    isIncluded: false,
    isDirty: false,
    isReadOnly: false,
    isCircular: false,
    canDuplicate: true,
    stats,
    badges: [],
    derivedFrom: [],
  }
}

/** A contig of an assembly with several, drawn under it. */
export function contigToItem(contig: Contig, ctx: AdapterContext): ExplorerItem {
  const { doc } = contig
  return {
    uid: toUid('contig', contig.id),
    kind: 'contig',
    id: contig.id,
    name: contig.name,
    createdAt: contig.createdAt,
    modifiedAt: contig.modifiedAt,
    size: doc.width,
    isOpen: isOpen(ctx, 'contig', contig.id),
    isIncluded: false,
    isDirty: contig.undoStack.length > 0,
    isReadOnly: false,
    isCircular: false,
    canDuplicate: false,
    stats: [formatCount(doc.rows.length, 'read'), formatBp(doc.width)],
    badges: [],
    derivedFrom: [],
    parentUid: toUid('assembly', contig.assemblyId),
  }
}

/**
 * An assembly as one row. With a single contig the row is that contig: it
 * opens it, and reads as open while it is. With several, the contigs are
 * drawn under it and the row opens the assembly's overview.
 */
export function assemblyToItem(assembly: Assembly, contigs: readonly Contig[], ctx: AdapterContext): ExplorerItem {
  const single = contigs.length === 1 ? contigs[0] : null
  const samples = assembly.samples ?? []
  if (samples.length && contigs.length === 0) {
    const ngs = samples[0]
    const r = ngs.report
    const mapped = samples.reduce((n, x) => n + x.report.mapped, 0)
    const reads = samples.reduce((n, x) => n + x.report.reads, 0)
    return {
      uid: toUid('assembly', assembly.id), kind: 'assembly', id: assembly.id, name: assembly.name,
      createdAt: assembly.createdAt, modifiedAt: assembly.modifiedAt, size: reads,
      isOpen: isOpen(ctx, 'assembly', assembly.id), isIncluded: false, isDirty: false, isReadOnly: false,
      isCircular: false, canDuplicate: false,
      stats: assembly.denovo
        ? [formatCount(assembly.denovo.contigs.length, 'contig'), 'de novo', formatBp(assembly.denovo.contigs.reduce((n, c) => n + c.length, 0)), ngs.readSetName]
        : [`${reads ? Math.round((mapped / reads) * 100) : 0}% mapped`, `vs ${r.references.map(x => x.name).join(', ')}`, samples.length > 1 ? formatCount(samples.length, 'sample') : ngs.readSetName],
      badges: [],
      derivedFrom: [...samples.flatMap(x => (x.readSetId ? [toUid('readset', x.readSetId)] : [])), ...r.references.flatMap(x => (x.tabId ? [toUid('sequence', x.tabId)] : []))],
    }
  }
  const reads = contigs.reduce((n, c) => n + c.doc.rows.length, 0)
  const width = contigs.reduce((n, c) => n + c.doc.width, 0)
  const stats = single ? [formatCount(reads, 'read')] : [formatCount(contigs.length, assembly.grouping ? 'clone' : 'contig'), formatCount(reads, 'read')]
  const ref = assembly.inputs.reference
  const refCount = assembly.inputs.references?.length ?? 0
  stats.push(assembly.method !== 'reference' ? 'de novo' : refCount > 1 ? `vs ${refCount} references` : ref ? `vs ${ref.name}` : 'mapped')
  if (single) stats.push(formatBp(width))
  const badges: ItemBadge[] = []
  const left = assembly.unplaced.length
  if (left > 0) {
    badges.push({
      key: 'unplaced',
      label: `${formatCount(left, 'read')} not placed in any contig`,
      icon: TriangleAlert,
      tone: 'warn',
    })
  }
  const modified = contigs.reduce((m, c) => Math.max(m, c.modifiedAt), assembly.modifiedAt)
  return {
    uid: toUid('assembly', assembly.id),
    kind: 'assembly',
    id: assembly.id,
    name: assembly.name,
    createdAt: assembly.createdAt,
    modifiedAt: modified,
    size: reads,
    isOpen: isOpen(ctx, 'assembly', assembly.id) || (!!single && isOpen(ctx, 'contig', single.id)),
    isIncluded: false,
    isDirty: !!single && single.undoStack.length > 0,
    isReadOnly: false,
    isCircular: false,
    canDuplicate: false,
    stats,
    badges,
    derivedFrom: [
      ...(ref?.tabId ? [toUid('sequence', ref.tabId)] : []),
      ...assembly.inputs.readIds.map(id => toUid('read', id)),
    ],
  }
}

export function gelToItem(gel: GelDoc, ctx: AdapterContext): ExplorerItem {
  const { conditions, lanes } = gel.state
  const loaded = lanes.filter(l => l.sample.kind !== 'empty').length
  return {
    uid: toUid('gel', gel.id),
    kind: 'gel',
    id: gel.id,
    name: gel.name,
    createdAt: gel.createdAt,
    modifiedAt: gel.modifiedAt,
    size: loaded,
    isOpen: isOpen(ctx, 'gel', gel.id),
    isIncluded: false,
    isDirty: false,
    isReadOnly: false,
    isCircular: false,
    canDuplicate: true,
    stats: [formatCount(loaded, 'lane'), `${conditions.agarosePct}% ${conditions.buffer}`],
    badges: [],
    // A gel draws on any number of sequences, so it is not nested under one.
    derivedFrom: [],
  }
}

/**
 * A cloning design as a row.
 *
 * The parts it uses are named as what it is derived from, so a design sits
 * under its sources in the tree the way a contig sits under its reads. Its
 * products are not: they only exist once the design is run, and whichever one
 * the user keeps becomes a sequence of its own.
 */
export function cloneToItem(clone: CloneDoc, ctx: AdapterContext): ExplorerItem {
  const { design } = clone
  const parts = design.parts.length
  const stats = [
    METHOD_LABEL[design.method],
    formatCount(parts, 'part'),
  ]
  const badges: ItemBadge[] = []
  // A part whose source has been edited since is worth knowing about before
  // trusting the product.
  // Only when the source is open and demonstrably different. A source that
  // is not open says nothing either way.
  const stale = design.parts.some(p => {
    if (!p.source) return false
    const current = ctx.tabSequenceById?.get(p.source.id)
    return current !== undefined && !partMatchesSource(p, current.bases, current.topology)
  })
  if (stale) {
    badges.push({
      key: 'stale-source',
      label: 'A sequence this design uses has been edited since',
      icon: TriangleAlert,
      tone: 'warn',
    })
  }

  return {
    uid: toUid('clone', clone.id),
    kind: 'clone',
    id: clone.id,
    name: clone.name,
    createdAt: clone.createdAt,
    modifiedAt: clone.modifiedAt,
    size: parts,
    isOpen: isOpen(ctx, 'clone', clone.id),
    isIncluded: false,
    isDirty: false,
    isReadOnly: false,
    isCircular: false,
    canDuplicate: true,
    stats,
    badges,
    derivedFrom: design.parts
      .map(p => p.source?.id)
      .filter((id): id is string => !!id && ctx.tabNameById.has(id))
      .map(id => toUid('sequence', id)),
  }
}
