/**
 * Shared annotation hover tooltip.
 *
 * Shows name, type, interval, length, strand, first 60 bases,
 * and protein translation for CDS/gene annotations.
 * Used by FeatureSidebar, SequenceView, and PlasmidMap.
 */

import type { Annotation } from '../models/Annotation'
import type { Sequence } from '../models/Sequence'
import { useClampedPosition } from '../hooks/useClampedPosition'
import {
  annotationBases,
  annotationProtein,
  canTranslateAnnotation,
} from '../utils/annotation-sequence'

/** Tooltip content without positioning wrapper - for embedding in context menus. */
export function AnnotationTooltipContent({ ann, sequence }: { ann: Annotation; sequence: Sequence }) {
  const seqLen = sequence.length
  const spansOrigin = ann.start > ann.end
  const len = spansOrigin ? seqLen - ann.start + ann.end : ann.end - ann.start

  const fullBases = annotationBases(ann, sequence)

  // Show ~3 rows of content (approx 30 chars/row at current font/width)
  const MAX_DISPLAY = 90
  const displayBases = fullBases.slice(0, MAX_DISPLAY)
  const baseTruncated = len > MAX_DISPLAY

  let protein = ''
  let proteinAaCount = 0
  const showProtein = canTranslateAnnotation(ann, sequence)
  if (showProtein) {
    const fullProtein = annotationProtein(ann, sequence)
    proteinAaCount = fullProtein.length
    protein = fullProtein.length > MAX_DISPLAY ? fullProtein.slice(0, MAX_DISPLAY) : fullProtein
  }

  return (
    <>
      <div className="ft-tooltip-name">
        <span className="ann-swatch" style={{ backgroundColor: ann.color, marginRight: 6 }} />
        {ann.name}
      </div>
      <table className="ft-tooltip-table">
        <tbody>
          <tr><td>Type</td><td>{ann.type}</td></tr>
          <tr><td>Interval</td><td>{ann.start + 1}..{ann.end}</td></tr>
          <tr><td>Length</td><td>{len} bp</td></tr>
          <tr><td>Strand</td><td>{ann.strand === 1 ? 'Forward (+)' : ann.strand === -1 ? 'Reverse (−)' : 'None'}</td></tr>
        </tbody>
      </table>
      {displayBases && (
        <div className="ft-tooltip-bases">
          {displayBases}{baseTruncated ? '…' : ''}
        </div>
      )}
      {showProtein && protein && (
        <div className="ft-tooltip-bases ft-tooltip-protein">
          {protein}{proteinAaCount > 60 ? '…' : ''} ({proteinAaCount} aa)
        </div>
      )}
    </>
  )
}

interface Props {
  ann: Annotation
  sequence: Sequence
  x: number
  y: number
}

export default function AnnotationTooltip({ ann, sequence, x, y }: Props) {
  const { ref, pos } = useClampedPosition(x, y)

  return (
    <div
      ref={ref}
      className="ft-tooltip"
      style={{ position: 'fixed', left: pos.left, top: pos.top, pointerEvents: 'none' }}
    >
      <AnnotationTooltipContent ann={ann} sequence={sequence} />
    </div>
  )
}
