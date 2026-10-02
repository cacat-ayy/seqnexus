/**
 * Per-kind adapters: the only code that knows what distinguishes a contig
 * from a chromatogram.
 *
 * Everything downstream of here (rows, grouping, selection, the context menu)
 * works on `ExplorerItem` and never branches on kind again.
 */

import { Lock, TriangleAlert, Globe, FlaskConical, Wand2, Activity, TestTube, Link2, Scissors } from 'lucide-react'
import type { LibraryOligo } from '../primers/oligo'
import { oligoTm } from '../primers/display'
import type {
  DocumentTab, SequencingRead, SavedAlignment, Contig, GelDoc,
} from '../store'
import type { DocumentOrigin } from '../models/Document'
import type { ExplorerItem, ItemBadge, ItemKind } from './types'
import { toUid } from './types'
import { formatBases, formatPercent, formatCount, meanQuality } from './format'
import { readQc } from '../sanger/qc'
import { originLabel } from '../msa/model'
import { summarize } from '../msa/stats'

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

export function sequenceToItem(tab: DocumentTab, ctx: AdapterContext): ExplorerItem {
  const circular = tab.doc.sequence.topology === 'circular'
  const features = tab.doc.annotations.length

  const badges: ItemBadge[] = []
  const originBadge = tab.doc.metadata?.origin && ORIGIN_BADGE[tab.doc.metadata.origin]
  if (originBadge) badges.push(originBadge)
  if (tab.readOnly) badges.push(READ_ONLY_BADGE)

  return {
    uid: toUid('sequence', tab.id),
    kind: 'sequence',
    id: tab.id,
    name: tab.doc.name,
    createdAt: tab.createdAt,
    modifiedAt: tab.modifiedAt,
    size: tab.doc.sequence.length,
    isOpen: isOpen(ctx, 'sequence', tab.id),
    isIncluded: false,
    isDirty: tab.undoStack.length > 0,
    isReadOnly: tab.readOnly,
    isCircular: circular,
    canDuplicate: true,
    stats: [
      formatBases(tab.doc.sequence.length),
      circular ? 'circular' : 'linear',
      formatCount(features, 'feature'),
    ],
    badges,
    derivedFrom: [],
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

  const stats = [isTrimmed ? `${formatBases(trimmed)} of ${formatBases(total)}` : formatBases(total)]
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

export function contigToItem(contig: Contig, ctx: AdapterContext): ExplorerItem {
  const { doc } = contig
  const stats = [formatCount(doc.rows.length, 'read')]
  if (doc.reference) stats.push(`vs ${doc.reference.name}`)
  else stats.push('de novo')
  stats.push(formatBases(doc.width))

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
    stats,
    badges: [],
    derivedFrom: [
      ...(doc.reference?.tabId ? [toUid('sequence', doc.reference.tabId)] : []),
      ...doc.rows.filter(r => r.readId).map(r => toUid('read', r.readId!)),
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
