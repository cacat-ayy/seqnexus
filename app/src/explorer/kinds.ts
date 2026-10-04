/**
 * What each item kind is called and what glyph stands for it.
 *
 * The icon slot used to report topology (a circle or a ruler), which left no
 * way to tell a sequence from an alignment at a glance. Kind owns the icon
 * now; topology is a pip on top of it and a word in the metadata line.
 */

import { Dna, Activity, AlignLeft, Layers, MoveRight, GalleryVertical, Combine, type LucideIcon } from 'lucide-react'
import type { ItemKind } from './types'

export const KIND_ICON: Record<ItemKind, LucideIcon> = {
  'sequence': Dna,
  'read': Activity,
  'alignment': AlignLeft,
  'contig': Layers,
  'gel': GalleryVertical,
  // Parts brought together into one construct.
  'clone': Combine,
  // A primer is drawn as an arrow everywhere else in the app.
  'oligo': MoveRight,
}

export const KIND_LABEL: Record<ItemKind, string> = {
  'sequence': 'Sequence',
  'read': 'Sequencing read',
  'alignment': 'Alignment',
  'contig': 'Contig',
  'gel': 'Gel',
  'clone': 'Cloning',
  'oligo': 'Oligo',
}

/** Group headings, in the order the tree lists them. */
export const KIND_GROUP_LABEL: Record<ItemKind, string> = {
  'sequence': 'Sequences',
  'read': 'Sequencing',
  'alignment': 'Alignments',
  'contig': 'Contigs',
  'gel': 'Gels',
  'clone': 'Cloning',
  'oligo': 'Oligos',
}

export const KIND_ORDER: readonly ItemKind[] = [
  'sequence', 'read', 'alignment', 'contig', 'gel', 'clone', 'oligo',
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
