/**
 * A junction, base by base.
 *
 * The seam is where cloning goes wrong quietly: a frame slips by one base, a
 * site survives that should have been cut away, an overhang is a base short.
 * None of that shows in a product's length, so this draws the bases either
 * side of each junction on both strands, marks which part each came from, and
 * says whether the reading frame carries across.
 */

import { useMemo } from 'react'
import { reverseComplement } from '../../models/complement'
import { translateCodon } from '../../utils/codon'
import type { Assembly } from '../../cloning/product'
import { endLabel } from '../../cloning/ends'
import { partColor } from './colors'

interface Props {
  product: Assembly
  /** How many bases to show either side of the seam. */
  flank?: number
}

interface Seam {
  index: number
  at: number
  left: string
  right: string
  leftName: string
  rightName: string
  leftPart: number
  rightPart: number
  label: string
  /** Bases shared by both parts at this junction, when they were joined on homology. */
  overlap: number
}

/** Bases from a circular product, wrapping the origin. */
function read(seq: string, start: number, length: number): string {
  if (length <= 0 || seq.length === 0) return ''
  let out = ''
  for (let i = start; i < start + length; i++) out += seq[((i % seq.length) + seq.length) % seq.length]
  return out
}

export default function JunctionInspector({ product, flank = 12 }: Props) {
  const seams = useMemo<Seam[]>(() => {
    const circular = product.topology === 'circular'
    return product.junctions.map((junction, index) => {
      const at = junction.at
      const left = circular || at - flank >= 0
        ? read(product.sequence, at - flank, flank)
        : product.sequence.slice(0, at)
      const right = read(product.sequence, at, flank)
      return {
        index,
        at,
        left,
        right,
        leftName: product.parts[junction.leftPart]?.name ?? '',
        rightName: product.parts[junction.rightPart]?.name ?? '',
        leftPart: junction.leftPart,
        rightPart: junction.rightPart,
        label: junction.overlap
          ? `${junction.overlap.length} bp shared${junction.overlap.mismatches > 0 ? `, ${junction.overlap.mismatches} mismatched` : ''}`
          : junction.end
            ? endLabel(junction.end)
            : '',
        overlap: junction.overlap?.length ?? 0,
      }
    })
  }, [product, flank])

  if (seams.length === 0) {
    return <p className="cw-hint">This product has no junctions: it is one piece.</p>
  }

  return (
    <div className="cw-seams">
      {seams.map(seam => {
        const top = seam.left + seam.right
        const bottom = reverseComplement(top).split('').reverse().join('')
        // Read the six bases straddling the seam as codons would fall if the
        // frame ran straight through it, which is what a fusion needs.
        const across = top.slice(Math.max(0, seam.left.length - 3), seam.left.length + 3)
        const codon = across.length === 6 ? translateCodon(across.slice(0, 3)) + translateCodon(across.slice(3)) : ''

        return (
          <div key={seam.index} className="cw-seam">
            <div className="cw-seam-head">
              <span className="cw-seam-part">
                <span className="cw-chip-dot" style={{ background: partColor(seam.leftPart) }} aria-hidden="true" />
                {seam.leftName}
              </span>
              <span className="cw-seam-label">{seam.label}</span>
              <span className="cw-seam-part">
                <span className="cw-chip-dot" style={{ background: partColor(seam.rightPart) }} aria-hidden="true" />
                {seam.rightName}
              </span>
            </div>

            <div className="cw-seam-strands">
              <div className="cw-seam-row">
                <span className="cw-seam-side">5′</span>
                <span className="cw-seam-bases">
                  <span className="cw-seam-from-left">{seam.left}</span>
                  <span className="cw-seam-join" aria-hidden="true" />
                  <span className="cw-seam-from-right">{seam.right}</span>
                </span>
                <span className="cw-seam-side">3′</span>
              </div>
              <div className="cw-seam-row cw-seam-bottom">
                <span className="cw-seam-side">3′</span>
                <span className="cw-seam-bases">
                  <span className="cw-seam-from-left">{bottom.slice(0, seam.left.length)}</span>
                  <span className="cw-seam-join" aria-hidden="true" />
                  <span className="cw-seam-from-right">{bottom.slice(seam.left.length)}</span>
                </span>
                <span className="cw-seam-side">5′</span>
              </div>
            </div>

            <p className="cw-seam-note">
              At {seam.at.toLocaleString()}
              {seam.overlap > 0 && <> · the first {seam.overlap} bases after the seam are shared by both parts</>}
              {codon && <> · reading straight through: {codon}</>}
            </p>
          </div>
        )
      })}
    </div>
  )
}
