/**
 * The design, drawn.
 *
 * With a product, the parts are laid out in the order they were joined — round
 * a ring when the product is circular, along a line when it is not — each arc
 * sized by how much of the construct it contributes, with a mark at every
 * junction saying what holds it together.
 *
 * Without a product, the same parts are drawn as separate blocks with their
 * ends shown, which is the useful picture when nothing fits: you can see that
 * one end is blunt and its neighbour sticky, or that an arm is missing.
 */

import { useMemo } from 'react'
import type { Assembly } from '../../cloning/product'
import { endLabel } from '../../cloning/ends'
import type { CloningDesign, DesignPart } from '../../cloning/design'
import { partLength, partTopology, vectorsFirst } from '../../cloning/design'
import { partColor } from './colors'

interface Props {
  design: CloningDesign
  product: Assembly | null
  hovered: string | null
  onHover: (partId: string | null) => void
  onPick?: (partId: string) => void
}

const SIZE = 320
const CENTRE = SIZE / 2
const RADIUS = 112
const RING = 26
/** Two junction labels closer together than this would overlap. */
const MIN_LABEL_GAP = 0.28

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

export default function AssemblyDiagram({ design, product, hovered, onHover, onPick }: Props) {
  const parts = useMemo(() => vectorsFirst(design.parts), [design.parts])
  const indexOfPart = useMemo(() => {
    const map = new Map<string, number>()
    parts.forEach((p, i) => map.set(p.id, i))
    return map
  }, [parts])

  if (parts.length === 0) {
    return (
      <div className="cw-diagram cw-diagram-empty">
        <p>Add the sequences you are cloning and the design will be drawn here.</p>
      </div>
    )
  }

  if (product && product.parts.length > 0) {
    return product.topology === 'circular'
      ? <Ring product={product} indexOfPart={indexOfPart} hovered={hovered} onHover={onHover} onPick={onPick} />
      : <Line product={product} indexOfPart={indexOfPart} hovered={hovered} onHover={onHover} onPick={onPick} />
  }

  return <Loose parts={parts} design={design} hovered={hovered} onHover={onHover} onPick={onPick} />
}

interface BuiltProps {
  product: Assembly
  indexOfPart: ReadonlyMap<string, number>
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

function Ring({ product, indexOfPart, hovered, onHover, onPick }: BuiltProps) {
  const total = product.size || 1
  let angle = 0
  const arcs = product.parts.map((part, i) => {
    const span = Math.max(part.end - part.start, 1)
    const from = angle
    const to = angle + (span / total) * Math.PI * 2
    angle = to
    return { part, i, from, to, span }
  })

  return (
    <div className="cw-diagram">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${product.name}, ${formatBp(product.size)} circular`}>
        {arcs.map(({ part, i, from, to }) => {
          const colorIndex = indexOfPart.get(part.fragmentId) ?? i
          const isHover = hovered === part.fragmentId
          return (
            <path
              key={`${part.fragmentId}-${i}`}
              d={arcPath(from, to)}
              fill={partColor(colorIndex)}
              className={`cw-arc ${isHover ? 'hovered' : ''}`}
              onMouseEnter={() => onHover(part.fragmentId)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onPick?.(part.fragmentId)}
            >
              <title>{`${part.name}${part.reversed ? ' (flipped)' : ''} — ${formatBp(part.end - part.start)}`}</title>
            </path>
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
            const [lx, ly] = polar(from, RADIUS + RING / 2 + 14 + tier * 12)
            return (
              <g key={`j${i}`} className="cw-junction">
                <line x1={x1} y1={y1} x2={x2} y2={y2} />
                {text && (
                  <text x={lx} y={ly} textAnchor={lx < CENTRE - 2 ? 'end' : lx > CENTRE + 2 ? 'start' : 'middle'} dominantBaseline="middle">
                    {text}
                  </text>
                )}
              </g>
            )
          })
        })()}

        <text x={CENTRE} y={CENTRE - 6} className="cw-ring-name" textAnchor="middle">{product.name}</text>
        <text x={CENTRE} y={CENTRE + 12} className="cw-ring-size" textAnchor="middle">
          {formatBp(product.size)} circular
        </text>
      </svg>
    </div>
  )
}

function Line({ product, indexOfPart, hovered, onHover, onPick }: BuiltProps) {
  return (
    <div className="cw-diagram">
      <div className="cw-line" role="img" aria-label={`${product.name}, ${formatBp(product.size)} linear`}>
        {product.parts.map((part, i) => {
          const span = Math.max(part.end - part.start, 1)
          const colorIndex = indexOfPart.get(part.fragmentId) ?? i
          const text = junctionText(product, i)
          return (
            <div
              key={`${part.fragmentId}-${i}`}
              className={`cw-block ${hovered === part.fragmentId ? 'hovered' : ''}`}
              style={{ flexGrow: span, background: partColor(colorIndex) }}
              onMouseEnter={() => onHover(part.fragmentId)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onPick?.(part.fragmentId)}
              title={`${part.name}${part.reversed ? ' (flipped)' : ''} — ${formatBp(span)}`}
            >
              <span className="cw-block-name">{part.name}{part.reversed ? ' ↩' : ''}</span>
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
 * The parts on their own, with the shape of each end.
 *
 * This is what shows when nothing assembles, so the ends are the point: a tab
 * for a protruding strand, a flat edge for a blunt one, a dashed edge for an
 * end that homology is supposed to cover.
 */
function Loose({
  parts,
  design,
  hovered,
  onHover,
  onPick,
}: {
  parts: DesignPart[]
  design: CloningDesign
  hovered: string | null
  onHover: (partId: string | null) => void
  onPick?: (partId: string) => void
}) {
  const seamless = design.method === 'homology'
  return (
    <div className="cw-diagram">
      <div className="cw-loose">
        {parts.map((part, i) => (
          <div
            key={part.id}
            className={`cw-loose-part ${hovered === part.id ? 'hovered' : ''}`}
            onMouseEnter={() => onHover(part.id)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onPick?.(part.id)}
          >
            <span className={`cw-end ${seamless ? 'homology' : 'unknown'}`} aria-hidden="true" />
            <span
              className={`cw-loose-body ${partTopology(part) === 'circular' ? 'circular' : ''}`}
              style={{ borderColor: partColor(i) }}
            >
              <span className="cw-loose-name">{part.name}</span>
              <span className="cw-loose-size">{formatBp(partLength(part))}</span>
            </span>
            <span className={`cw-end ${seamless ? 'homology' : 'unknown'}`} aria-hidden="true" />
          </div>
        ))}
      </div>
      <p className="cw-line-caption">
        {seamless
          ? 'Parts need matching ends to join. Nothing has assembled yet.'
          : 'Nothing has assembled yet.'}
      </p>
    </div>
  )
}
