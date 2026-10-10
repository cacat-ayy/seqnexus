/**
 * The documents a strategy produces.
 *
 * A deletion and a donor are both sequences the user will want to keep, look
 * at and export, so they are opened as real documents with their features
 * carried over, rather than shown as text to copy. What was removed, and what
 * was changed to stop a donor being cut again, goes in the description, which
 * is where the rest of the app puts the story of where a sequence came from.
 */

import { Sequence } from '../../models/Sequence'
import { Annotation, type AnnotationData } from '../../models/Annotation'
import type { DocumentState } from '../../models/Document'
import { applyDeletion, type DeletionPair } from './deletion'
import type { KnockinDonor } from './knockin'
import type { FeatureLike } from './coding'

/** The feature colour guides and their products carry; data, as elsewhere. */
const GUIDE_COLOR = '#7c3aed'

export function deletionDocument(
  doc: DocumentState,
  pair: DeletionPair,
  nucleaseName: string,
): DocumentState {
  const features: FeatureLike[] = doc.annotations.map(a => ({
    name: a.name,
    type: a.type,
    start: a.start,
    end: a.end,
    strand: a.strand,
    ...(a.segments ? { segments: a.segments } : {}),
    ...(a.qualifiers ? { qualifiers: a.qualifiers } : {}),
  }))
  const result = applyDeletion(doc.sequence.bases, features, pair)

  const lines = [
    `${pair.length.toLocaleString()} bp removed with ${nucleaseName}, between the cuts of `
    + `${pair.left.site.spacer} and ${pair.right.site.spacer}.`,
    `Junction: ${pair.junction}`,
  ]
  if (result.removed.length > 0) {
    lines.push(`Features removed: ${result.removed.map(f => f.name).join(', ')}`)
  }

  const annotations: AnnotationData[] = result.features.map((f, i) => ({
    id: `del_${i}`,
    name: f.name,
    type: f.type,
    start: f.start,
    end: f.end,
    strand: f.strand,
    ...(f.qualifiers ? { qualifiers: f.qualifiers } : {}),
    ...(f.truncated ? { truncated: true as const } : {}),
  }))
  // A mark at the join, since it is the one place the sequence is new.
  annotations.push({
    id: 'del_junction',
    name: 'Deletion junction',
    type: 'misc_feature',
    start: Math.max(0, pair.start - 1),
    end: Math.min(result.bases.length, pair.start + 1),
    strand: 0,
    color: GUIDE_COLOR,
    qualifiers: { note: [lines[0]] },
  })

  return {
    name: `${doc.name} del${pair.length}`,
    description: lines.join('\n'),
    sequence: new Sequence(result.bases, doc.sequence.topology),
    annotations: annotations.map(a => new Annotation(a)),
    metadata: { ...doc.metadata, origin: 'edited' },
  }
}

export function donorDocument(donor: KnockinDonor, sourceName: string, nucleaseName: string): DocumentState {
  const payloadStart = donor.leftArm.length
  const payloadEnd = payloadStart + donor.payload.length
  const annotations: AnnotationData[] = [
    {
      id: 'donor_left', name: 'Left arm', type: 'misc_feature',
      start: 0, end: donor.leftArm.length, strand: 0, color: GUIDE_COLOR,
    },
    {
      id: 'donor_right', name: 'Right arm', type: 'misc_feature',
      start: payloadEnd, end: donor.donor.length, strand: 0, color: GUIDE_COLOR,
    },
  ]
  if (donor.payload.length > 0) {
    annotations.push({
      id: 'donor_payload', name: 'Insert', type: 'misc_feature',
      start: payloadStart, end: payloadEnd, strand: 0,
    })
  }
  if (donor.block) {
    annotations.push({
      id: 'donor_block',
      name: donor.block.silent ? 'Silent change' : 'Change',
      type: 'variation',
      start: donor.block.donorAt,
      end: donor.block.donorAt + 1,
      strand: 0,
      qualifiers: {
        note: [`${donor.block.from} to ${donor.block.to} in the ${donor.block.where === 'pam' ? 'PAM' : 'seed'}, `
          + `so the donor is not cut again${donor.block.silent ? '; the protein is unchanged' : ''}`],
      },
    })
  }

  const lines = [
    `Donor for ${sourceName}, ${nucleaseName} guide ${donor.candidate.site.spacer}.`,
    `Arms ${donor.leftArm.length} and ${donor.rightArm.length} bp around position ${donor.insertAt + 1}.`,
  ]
  if (donor.block) {
    lines.push(
      `${donor.block.from} to ${donor.block.to} at donor position ${donor.block.donorAt + 1} `
      + `(${donor.block.where === 'pam' ? 'PAM' : 'seed'})`
      + `${donor.block.silent ? ', silent' : donor.block.codon ? `, ${donor.block.codon.aa} to ${donor.block.codon.toAa}` : ''}.`,
    )
  } else if (!donor.wouldRecut) {
    lines.push('The insert breaks the site, so nothing else needed changing.')
  }

  return {
    name: `${sourceName} donor`,
    description: lines.join('\n'),
    sequence: new Sequence(donor.donor, 'linear'),
    annotations: annotations.map(a => new Annotation(a)),
    metadata: { origin: 'edited' },
  }
}
