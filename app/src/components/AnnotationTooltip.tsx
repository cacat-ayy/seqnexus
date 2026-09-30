/**
 * Shared annotation hover card.
 *
 * Name and type, interval, length and strand, the bases and (for coding
 * features) the protein, each shortened to both ends when long, and any sign
 * that a CDS is drawn on the wrong bases or in the wrong frame.
 * Used by FeatureSidebar, SequenceView and PlasmidMap.
 */

import { TriangleAlert, Info } from 'lucide-react'
import type { Annotation } from '../models/Annotation'
import type { Sequence } from '../models/Sequence'
import HoverCard from './HoverCard'
import {
  annotationBases,
  annotationLength,
  annotationProtein,
  canTranslateAnnotation,
  headTail,
  translationIssues,
} from '../utils/annotation-sequence'

/** About three rows at the card's width. */
const MAX_DISPLAY = 90

function Abbreviated({ text }: { text: string }) {
  const ends = headTail(text, MAX_DISPLAY)
  if (!ends) return <>{text}</>
  return <>{ends.head}<span className="hc-ellipsis">…</span>{ends.tail}</>
}

/** Card body without the positioning frame, also used in the pinned copy. */
export function AnnotationTooltipContent({ ann, sequence }: { ann: Annotation; sequence: Sequence }) {
  const len = annotationLength(ann, sequence.length)
  const bases = annotationBases(ann, sequence)
  const translatable = canTranslateAnnotation(ann, sequence)
  const protein = translatable ? annotationProtein(ann, sequence) : ''
  const issues = translationIssues(ann, sequence)

  return (
    <>
      <div className="ft-tooltip-name">
        <span className="ann-swatch" style={{ backgroundColor: ann.color, marginRight: 6 }} />
        <span className="hc-name">{ann.name}</span>
        <span className="hc-chip">{ann.type}</span>
      </div>
      <table className="ft-tooltip-table">
        <tbody>
          <tr><td>Interval</td><td>{ann.start + 1}..{ann.end}</td></tr>
          <tr>
            <td>Length</td>
            <td>{len} bp{translatable && len % 3 === 0 && <span className="hc-muted"> · {len / 3} codons</span>}</td>
          </tr>
          <tr><td>Strand</td><td>{ann.strand === 1 ? 'Forward (+)' : ann.strand === -1 ? 'Reverse (−)' : 'None'}</td></tr>
        </tbody>
      </table>
      {bases && (
        <div className="ft-tooltip-bases">
          <Abbreviated text={bases} />
        </div>
      )}
      {protein && (
        <div className="ft-tooltip-bases ft-tooltip-protein">
          <Abbreviated text={protein} /> ({protein.length} aa)
        </div>
      )}
      {issues && (
        <div className="hc-issues">
          {issues.internalStops > 0 && (
            <div className="hc-issue">
              <TriangleAlert size={11} />
              {issues.internalStops} internal stop codon{issues.internalStops === 1 ? '' : 's'}: wrong frame or boundaries?
            </div>
          )}
          {issues.leftover > 0 && (
            <div className="hc-issue">
              <TriangleAlert size={11} />
              Not a whole number of codons ({issues.leftover} base{issues.leftover === 1 ? '' : 's'} left over)
            </div>
          )}
          {issues.badStart && (
            <div className="hc-issue hc-note">
              <Info size={11} />
              Starts with {issues.badStart}, not a start codon
            </div>
          )}
        </div>
      )}
    </>
  )
}

export default function AnnotationTooltip({ ann, sequence, x, y }: {
  ann: Annotation
  sequence: Sequence
  x: number
  y: number
}) {
  return (
    <HoverCard x={x} y={y} pinKey={`ann:${ann.id}`}>
      <AnnotationTooltipContent ann={ann} sequence={sequence} />
    </HoverCard>
  )
}
