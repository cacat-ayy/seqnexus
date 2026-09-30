/**
 * What each item kind is called and what glyph stands for it.
 *
 * The icon slot used to report topology (a circle or a ruler), which left no
 * way to tell a sequence from an alignment at a glance. Kind owns the icon
 * now; topology is a pip on top of it and a word in the metadata line.
 */

import { Dna, Activity, AlignLeft, ArrowRightLeft, Layers, MoveRight, type LucideIcon } from 'lucide-react'
import type { ItemKind } from './types'

export const KIND_ICON: Record<ItemKind, LucideIcon> = {
  'sequence': Dna,
  'read': Activity,
  'alignment': AlignLeft,
  'read-alignment': ArrowRightLeft,
  'contig': Layers,
  // A primer is drawn as an arrow everywhere else in the app.
  'oligo': MoveRight,
}

export const KIND_LABEL: Record<ItemKind, string> = {
  'sequence': 'Sequence',
  'read': 'Sequencing read',
  'alignment': 'Alignment',
  'read-alignment': 'Read alignment',
  'contig': 'Contig',
  'oligo': 'Oligo',
}

/** Group headings, in the order the tree lists them. */
export const KIND_GROUP_LABEL: Record<ItemKind, string> = {
  'sequence': 'Sequences',
  'read': 'Sequencing',
  'alignment': 'Alignments',
  'read-alignment': 'Read alignments',
  'contig': 'Contigs',
  'oligo': 'Oligos',
}

export const KIND_ORDER: readonly ItemKind[] = [
  'sequence', 'read', 'alignment', 'read-alignment', 'contig', 'oligo',
] as const

/**
 * Kinds whose group is drawn even when empty.
 *
 * Sequences and Sequencing are where work starts, so their headers double as
 * a place to drop files. The derived kinds only appear once something has
 * produced one, which is what the old explorer did too.
 */
export const ALWAYS_SHOWN_KINDS: ReadonlySet<ItemKind> = new Set<ItemKind>(['sequence', 'read'])

/** Mean Phred below this marks a read as low quality. */
export const LOW_QUALITY_THRESHOLD = 20
