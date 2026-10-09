/**
 * The reaction in one line: each piece going in, with its two ends written
 * out as both strands, then what comes out.
 *
 *   EcoRI          HindIII      EcoRI       HindIII
 *   AATTCG ...   ... A      +   AATTCG ...  ... A       ->  Product 3.4 kb
 *       GC ...   ... TTCGA          GC ...  ... TTCGA
 *
 * This is what SnapGene draws under its Insert Fragment dialog, and it is the
 * quickest way to see why two pieces will or will not join: an end that pairs
 * with an end of another piece is green, one that only pairs with its own
 * piece's other end (the piece will close on itself) is amber, and one that
 * pairs with nothing is red.
 */

import { ArrowRight, Plus } from 'lucide-react'
import type { Fragment } from '../../cloning/fragment'
import { endsAnneal, type End } from '../../cloning/ends'
import { endView } from '../../cloning/endview'
import type { Assembly } from '../../cloning/product'
import type { DesignPart } from '../../cloning/design'
import { isIntended } from '../../cloning/outcome'
import { partColor } from './colors'

export interface StripPiece {
  part: DesignPart
  /** The piece of its digest the part goes in as; null when it is not cut. */
  fragment: Fragment | null
  /** Index of the part in the design, for its colour. */
  index: number
}

interface Props {
  pieces: StripPiece[]
  product: Assembly | null
  selected: string
  onSelect: (tab: string) => void
}

function formatBp(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} kb` : `${n} bp`
}

type Fit = 'pairs' | 'self' | 'none'

/** How an end fits the other ends in the tube. */
function fitOf(end: End, own: Fragment, pieces: StripPiece[]): Fit {
  const others = pieces.filter(p => p.fragment && p.fragment !== own).flatMap(p => [p.fragment!.left, p.fragment!.right])
  if (others.some(e => e && endsAnneal(end, e))) return 'pairs'
  const mate = own.left === end ? own.right : own.left
  if (mate && endsAnneal(end, mate)) return 'self'
  return 'none'
}

const FIT_TEXT: Record<Fit, string> = {
  pairs: 'pairs with an end of another piece',
  self: 'pairs only with this piece’s other end, so it can close on itself',
  none: 'pairs with no other end',
}

function EndCell({ end, fragment, side, pieces }: {
  end: End | undefined
  fragment: Fragment
  side: 'left' | 'right'
  pieces: StripPiece[]
}) {
  const view = endView(fragment, side)
  if (!end || !view) return null
  const fit = fitOf(end, fragment, pieces)
  const kind = end.kind === 'blunt' ? 'blunt' : `${end.kind === 'five_prime' ? "5'" : "3'"} overhang`
  return (
    <span className={`cw-end ${fit} ${side}`} title={`${end.enzyme ?? 'End'}, ${kind}: ${FIT_TEXT[fit]}`}>
      <span className="cw-end-enzyme">{end.enzyme ?? kind}</span>
      <span className="cw-end-strands">
        <span>{side === 'right' ? '…' : ''}{view.top}{side === 'left' ? '…' : ''}</span>
        <span>{side === 'right' ? '…' : ''}{view.bottom}{side === 'left' ? '…' : ''}</span>
      </span>
    </span>
  )
}

export default function EndsStrip({ pieces, product, selected, onSelect }: Props) {
  const intended = product !== null && isIntended(product)
  return (
    <div className="cw-strip" aria-label="Pieces going into the reaction">
      {pieces.map(({ part, fragment, index }, i) => (
        <span key={part.id} className="cw-strip-group">
          {i > 0 && <Plus size={14} className="cw-strip-op" aria-hidden="true" />}
          <button
            className={`cw-piece ${selected === part.id ? 'active' : ''}`}
            onClick={() => onSelect(part.id)}
            title={`Show ${part.name}`}
          >
            {fragment && <EndCell end={fragment.left} fragment={fragment} side="left" pieces={pieces} />}
            <span className="cw-piece-body" style={{ borderColor: partColor(index) }}>
              <span className="cw-piece-name">{part.name}</span>
              <span className="cw-piece-size">{fragment ? formatBp(fragment.top.length) : 'not cut'}</span>
            </span>
            {fragment && <EndCell end={fragment.right} fragment={fragment} side="right" pieces={pieces} />}
          </button>
        </span>
      ))}
      <ArrowRight size={16} className="cw-strip-op" aria-hidden="true" />
      <button
        className={`cw-piece cw-piece-product ${intended ? 'ok' : product ? 'partial' : 'none'} ${selected === 'product' ? 'active' : ''}`}
        onClick={() => onSelect('product')}
        title="Show the product"
      >
        <span className="cw-piece-body">
          <span className="cw-piece-name">{product ? 'Product' : 'No product'}</span>
          <span className="cw-piece-size">
            {product ? `${formatBp(product.size)} ${product.topology}` : 'nothing forms'}
          </span>
        </span>
      </button>
    </div>
  )
}
