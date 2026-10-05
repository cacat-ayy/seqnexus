/**
 * What each item kind is called and what glyph stands for it.
 *
 * The icon slot used to report topology (a circle or a ruler), which left no
 * way to tell a sequence from an alignment at a glance. Kind owns the icon
 * now; topology is a pip on top of it and a word in the metadata line.
 */

import { Dna, Activity, AlignLeft, Layers, MoveRight, GalleryVertical, Combine, Rows3, FileStack, type LucideIcon } from 'lucide-react'
import type { ItemKind } from './types'

export const KIND_ICON: Record<ItemKind, LucideIcon> = {
  'sequence': Dna,
  'read': Activity,
  // NGS reads: many short records, stacked.
  'readset': FileStack,
  'alignment': AlignLeft,
  'assembly': Layers,
  // One contig of an assembly with several: its reads stacked in rows.
  'contig': Rows3,
  'gel': GalleryVertical,
  // Parts brought together into one construct.
  'clone': Combine,
  // A primer is drawn as an arrow everywhere else in the app.
  'oligo': MoveRight,
}

export const KIND_LABEL: Record<ItemKind, string> = {
  'sequence': 'Sequence',
  'read': 'Sequencing read',
  'readset': 'Read set',
  'alignment': 'Alignment',
  'assembly': 'Assembly',
  'contig': 'Contig',
  'gel': 'Gel',
  'clone': 'Cloning',
  'oligo': 'Oligo',
}

/** Group headings, in the order the tree lists them. */
export const KIND_GROUP_LABEL: Record<ItemKind, string> = {
  'sequence': 'Sequences',
  'read': 'Sequencing',
  'readset': 'Read sets',
  'alignment': 'Alignments',
  'assembly': 'Assemblies',
  'contig': 'Contigs',
  'gel': 'Gels',
  'clone': 'Cloning',
  'oligo': 'Oligos',
}

export const KIND_ORDER: readonly ItemKind[] = [
  'sequence', 'read', 'readset', 'alignment', 'assembly', 'contig', 'gel', 'clone', 'oligo',
] as const

/**
 * Kinds whose group is drawn even when empty.
 *
 * Sequences are where work starts, so that header doubles as a place to drop
 * files. Every other kind, sequencing reads included, appears only once there
 * is something in it: an empty Sequencing group in every workspace is noise
 * for anyone not doing Sanger work.
 */
export const ALWAYS_SHOWN_KINDS: ReadonlySet<ItemKind> = new Set<ItemKind>(['sequence'])

/** Mean Phred below this marks a read as low quality. */
export const LOW_QUALITY_THRESHOLD = 20

/**
 * Kinds that are only ever part of another item (a contig of an assembly).
 * They are drawn under their parent and get no group or filter of their own.
 */
export const PART_KINDS: ReadonlySet<ItemKind> = new Set<ItemKind>(['contig'])
