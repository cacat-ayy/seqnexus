/**
 * The design, drawn.
 *
 * With a product, the parts are laid out in the order they were joined — round
 * a ring when the product is circular, along a line when it is not — each arc
 * sized by how much of the construct it contributes and named where there is
 * room, with a mark at every junction saying what holds it together.
 *
 * Without a product, the same parts are drawn as separate blocks with their
 * ends written beside them, which is the useful picture when nothing fits:
 * you can see that one end is blunt and its neighbour sticky.
 *
 * Colours follow the parts list, so a part is the same colour everywhere.
 */

import type { Assembly } from '../../cloning/product'
import type { Fragment } from '../../cloning/fragment'
import { endLabel } from '../../cloning/ends'
import type { CloningDesign, DesignPart } from '../../cloning/design'
import { partLength, partTopology, vectorsFirst } from '../../cloning/design'
import { designPartFor, keptFragment } from '../../cloning/outcome'
import { partColor } from './colors'

interface Props {
  design: CloningDesign
  product: Assembly | null
  /** The digest's fragments, for the ends of parts that did not join. */
  fragments: Fragment[]
  hovered: string | null
  onHover: (partId: string | null) => void
  onPick?: (partId: string) => void
}

const SIZE = 340
const CENTRE = SIZE / 2
const RADIUS = 112
const RING = 26
/** Two junction labels closer together than this would overlap. */
const MIN_LABEL_GAP = 0.28
/** An arc shorter than this has no room for its name. */
const MIN_NAME_SPAN = 0.55

function polar(angle: number, radius: number): [number, number] {
  const a = angle - Math.PI / 2
  return [CENTRE + radius * Math.cos(a), CENTRE + radius * Math.sin(a)]
}

/** An annulus wedge from `from` to `to`, in radians. */
function arcPath(from: number, to: number): string {
  const outer = RADIUS + RING / 2
  const inner = RADIUS - RING / 2
  const long = to - from > Math.PI ? 1 : 0
  const [ox1, oy1] = polar(from, outer)
  const [ox2, oy2] = polar(to, outer)
  const [ix2, iy2] = polar(to, inner)
  const [ix1, iy1] = polar(from, inner)
  return [
    `M ${ox1} ${oy1}`,
    `A ${outer} ${outer} 0 ${long} 1 ${ox2} ${oy2}`,
    `L ${ix2} ${iy2}`,
    `A ${inner} ${inner} 0 ${long} 0 ${ix1} ${iy1}`,
    'Z',
  ].join(' ')
}

function formatBp(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} kb` : `${n} bp`
}

const anchorFor = (x: number) => (x < CENTRE - 2 ? 'end' : x > CENTRE + 2 ? 'start' : 'middle')
/** Inside the ring a label grows towards the centre, away from the arc. */
const insideAnchorFor = (x: number) => (x < CENTRE - 2 ? 'start' : x > CENTRE + 2 ? 'end' : 'middle')

export default function AssemblyDiagram({ design, product, fragments, hovered, onHover, onPick }: Props) {
  if (design.parts.length === 0) {
    return (
      <div className="cw-diagram cw-diagram-empty">
        <p>Add the sequences you are cloning and the design will be drawn here.</p>
      </div>
    )
  }

  /** The design part behind a piece of the product: its id and colour. */
  const look = (fragmentId: string, fallback: number) => {
    const part = designPartFor(fragmentId, design.parts)
    const index = part ? design.parts.indexOf(part) : fallback
    return { id: part?.id ?? fragmentId, color: partColor(index), label: part?.name }
  }

  if (product && product.parts.length > 0) {
    const props = { product, look, hovered, onHover, onPick }
    return product.topology === 'circular' ? <Ring {...props} /> : <Line {...props} />
  }

  return <Loose design={design} fragments={fragments} hovered={hovered} onHover={onHover} onPick={onPick} />
}

interface BuiltProps {
  product: Assembly
  look: (fragmentId: string, fallback: number) => { id: string; color: string; label: string | undefined }
  hovered: string | null
  onHover: (partId: string | null) => void
  onPick?: (partId: string) => void
}

function junctionText(product: Assembly, index: number): string {
  const junction = product.junctions.find(j => j.rightPart === index)
  if (!junction) return ''
  if (junction.overlap) return `${junction.overlap.length} bp`
  if (junction.end) return endLabel(junction.end)
  return ''
}

function Ring({ product, look, hovered, onHover, onPick }: BuiltProps) {
  const total = product.size || 1
  let angle = 0
  const arcs = product.parts.map((part, i) => {
    const span = Math.max(part.end - part.start, 1)
    const from = angle
    const to = angle + (span / total) * Math.PI * 2
    angle = to
    return { part, i, from, to, ...look(part.fragmentId, i) }
  })

  return (
    <div className="cw-diagram cw-diagram-ring">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${product.name}, ${formatBp(product.size)} circular`}>
        {arcs.map(({ part, i, from, to, id, color }) => (
          <path
            key={`${part.fragmentId}-${i}`}
            d={arcPath(from, to)}
            fill={color}
            className={`cw-arc ${hovered === id ? 'hovered' : ''}`}
            onMouseEnter={() => onHover(id)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onPick?.(id)}
          >
            <title>{`${part.name}${part.reversed ? ' (flipped)' : ''} — ${formatBp(part.end - part.start)}`}</title>
          </path>
        ))}

        {/* Each part's name inside the ring, where its arc is long enough. */}
        {arcs.map(({ part, i, from, to, color, label }) => {
          if (to - from < MIN_NAME_SPAN) return null
          const [x, y] = polar((from + to) / 2, RADIUS - RING / 2 - 12)
          return (
            <text
              key={`n${i}`}
              x={x}
              y={y}
              className="cw-arc-name"
              style={{ fill: color }}
              textAnchor={insideAnchorFor(x)}
              dominantBaseline="middle"
            >
              {label ?? part.name}{part.reversed ? ' ↩' : ''}
            </text>
          )
        })}

        {/* A tick and a label at every junction. Two junctions either side of
            a short part sit almost on top of each other, so each label is
            pushed further out than the last one it would have collided with
            rather than being drawn over it. */}
        {(() => {
          let lastAngle = -Infinity
          let tier = 0
          return arcs.map(({ from, i }) => {
            const text = junctionText(product, i)
            if (from - lastAngle < MIN_LABEL_GAP) tier += 1
            else tier = 0
            lastAngle = from
            const [x1, y1] = polar(from, RADIUS - RING / 2 - 3)
            const [x2, y2] = polar(from, RADIUS + RING / 2 + 3)
            const [lx, ly] = polar(from, RADIUS + RING / 2 + 14 + tier * 13)
            return (
              <g key={`j${i}`} className="cw-junction">
                <line x1={x1} y1={y1} x2={x2} y2={y2} />
                {text && (
                  <text x={lx} y={ly} textAnchor={anchorFor(lx)} dominantBaseline="middle">{text}</text>
                )}
              </g>
            )
          })
        })()}

        <text x={CENTRE} y={CENTRE - 7} className="cw-ring-name" textAnchor="middle">{product.name}</text>
        <text x={CENTRE} y={CENTRE + 13} className="cw-ring-size" textAnchor="middle">
          {formatBp(product.size)} circular
        </text>
      </svg>
    </div>
  )
}

function Line({ product, look, hovered, onHover, onPick }: BuiltProps) {
  return (
    <div className="cw-diagram">
      <div className="cw-line" role="img" aria-label={`${product.name}, ${formatBp(product.size)} linear`}>
        {product.parts.map((part, i) => {
          const span = Math.max(part.end - part.start, 1)
          const { id, color, label } = look(part.fragmentId, i)
          const text = junctionText(product, i)
          return (
            <div
              key={`${part.fragmentId}-${i}`}
              className={`cw-block ${hovered === id ? 'hovered' : ''}`}
              style={{ flexGrow: span, background: color }}
              onMouseEnter={() => onHover(id)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onPick?.(id)}
              title={`${part.name}${part.reversed ? ' (flipped)' : ''} — ${formatBp(span)}`}
            >
              <span className="cw-block-name">{label ?? part.name}{part.reversed ? ' ↩' : ''}</span>
              {text && i > 0 && <span className="cw-block-junction">{text}</span>}
            </div>
          )
        })}
      </div>
      <p className="cw-line-caption">{formatBp(product.size)} linear</p>
    </div>
  )
}

/**
 * The parts on their own, with the end each one is left with.
 *
 * This is what shows when nothing assembles, so the ends are the point: two
 * neighbours whose ends do not pair are the reason, written out.
 */
function Loose({
  design,
  fragments,
  hovered,
  onHover,
  onPick,
}: {
  design: CloningDesign
  fragments: Fragment[]
  hovered: string | null
  onHover: (partId: string | null) => void
  onPick?: (partId: string) => void
}) {
  const seamless = design.method === 'homology'
  const cut = design.method === 'restriction' || design.method === 'golden-gate'
  const parts: DesignPart[] = vectorsFirst(design.parts)
  return (
    <div className="cw-diagram">
      <div className="cw-loose">
        {parts.map(part => {
          const kept = cut ? keptFragment(part, fragments) : null
          const left = kept?.left ? endLabel(kept.left) : seamless ? 'needs overlap' : ''
          const right = kept?.right ? endLabel(kept.right) : seamless ? 'needs overlap' : ''
          return (
            <div
              key={part.id}
              className={`cw-loose-part ${hovered === part.id ? 'hovered' : ''}`}
              onMouseEnter={() => onHover(part.id)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onPick?.(part.id)}
            >
              <span className="cw-loose-end left">{left}</span>
              <span
                className={`cw-loose-body ${partTopology(part) === 'circular' && !kept ? 'circular' : ''}`}
                style={{ borderColor: partColor(design.parts.indexOf(part)) }}
              >
                <span className="cw-loose-name">{part.name}</span>
                <span className="cw-loose-size">
                  {kept ? `${formatBp(kept.top.length)} of ${formatBp(partLength(part))}` : formatBp(partLength(part))}
                </span>
              </span>
              <span className="cw-loose-end right">{right}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
