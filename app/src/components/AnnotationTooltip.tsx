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
import { unitOf } from '../models/alphabet'
import HoverCard from './HoverCard'
import {
  annotationBases,
  annotationLength,
  annotationProtein,
  canTranslateAnnotation,
  headTail,
  issueMessages,
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
  const issues = issueMessages(translationIssues(ann, sequence))

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
            <td>{len} {unitOf(sequence.alphabet)}{translatable && len % 3 === 0 && <span className="hc-muted"> · {len / 3} codons</span>}</td>
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
      {issues.length > 0 && (
        <div className="hc-issues">
          {issues.map(m => (
            <div key={m.text} className={m.severity === 'note' ? 'hc-issue hc-note' : 'hc-issue'}>
              {m.severity === 'note' ? <Info size={11} /> : <TriangleAlert size={11} />}
              {m.text}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default function AnnotationTooltip({ ann, sequence, x, y, above = false }: {
  ann: Annotation
  sequence: Sequence
  x: number
  y: number
  /** Open above (x, y): from a row in the panel along the bottom. */
  above?: boolean
}) {
  return (
    <HoverCard x={x} y={y} above={above} pinKey={`ann:${ann.id}`}>
      <AnnotationTooltipContent ann={ann} sequence={sequence} />
    </HoverCard>
  )
}
