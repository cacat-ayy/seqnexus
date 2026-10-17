/**
 * What the reaction gives, under the map.
 *
 * The product in front of you comes first, as one card that says what it is.
 * Everything else a real tube would also contain is folded away beneath it,
 * each named for what it is ("pUC19 closed on itself") rather than by a
 * second copy of the same "pUC19::pUC19". Knowing the vector will mostly
 * religate is worth something, but it should not crowd out the construct.
 *
 * When the construct does not form, this says why and offers the changes
 * that would make it form, each tried before it is offered.
 */

import { useState } from 'react'
import { ChevronRight, CircleCheck, CircleSlash, Info, TriangleAlert, Wand2 } from 'lucide-react'
import type { Assembly } from '../../cloning/product'
import type { CloningDesign } from '../../cloning/design'
import { productKey } from '../../cloning/run'
import { isIntended, missingPart, productLabel, whyNoConstruct, type DesignFix } from '../../cloning/outcome'
import { formatBp } from '../../utils/format'

interface Props {
  design: CloningDesign
  products: Assembly[]
  selected: Assembly | null
  problems: string[]
  warnings: string[]
  fixes: DesignFix[]
  fidelity?: { score: number; notes: string[] }
  onSelect: (key: string) => void
  onOpen: (product: Assembly) => void
  onFix: (fix: DesignFix) => void
}

/** What marks a product out, beyond what its label already says. */
function tagsOf(product: Assembly): { text: string; tone: 'warn' | 'plain' }[] {
  const tags: { text: string; tone: 'warn' | 'plain' }[] = []
  if (product.recut.length > 0) tags.push({ text: `cut again by ${product.recut.join(', ')}`, tone: 'warn' })
  if (product.nicked) tags.push({ text: 'nicked', tone: 'plain' })
  if (product.parts.some(p => p.reversed)) tags.push({ text: 'a part is flipped', tone: 'plain' })
  return tags
}

function Diagnosis({ title, problems, fixes, onFix }: {
  title: string
  problems: string[]
  fixes: DesignFix[]
  onFix: (fix: DesignFix) => void
}) {
  return (
    <div className="cw-diagnosis" role="status">
      <h4><CircleSlash size={15} />{title}</h4>
      {problems.length > 0 && <ul>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
      {fixes.length > 0 && (
        <div className="cw-fixes">
          <span className="cw-fixes-label">Try</span>
          {fixes.map(fix => (
            <button key={fix.label} className="cw-fix" onClick={() => onFix(fix)}>
              <Wand2 size={12} />{fix.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ProductsPanel({
  design,
  products,
  selected,
  problems,
  warnings,
  fixes,
  fidelity,
  onSelect,
  onOpen,
  onFix,
}: Props) {
  const [showOthers, setShowOthers] = useState(false)
  const hasIntended = products.some(isIntended)

  const warningList = warnings.length > 0 && (
    <ul className="cw-warnings">
      {warnings.map((w, i) => <li key={i}><Info size={13} />{w}</li>)}
    </ul>
  )

  if (products.length === 0 || !selected) {
    // With one part the engine's reasons (no shared ends, no homology between
    // parts) only restate that there is nothing to join, which the map says.
    if (missingPart(design)) return warningList ? <div className="cw-outcome">{warningList}</div> : null
    return (
      <div className="cw-outcome">
        <Diagnosis title="Nothing assembles yet" problems={problems} fixes={fixes} onFix={onFix} />
        {warningList}
      </div>
    )
  }

  const selectedKey = productKey(selected)
  const others = products.filter(p => productKey(p) !== selectedKey)
  // Two molecules can share a description (the same pieces with different
  // ends meeting), so a repeat is numbered rather than shown twice alike.
  const otherLabels = (() => {
    const seen = new Map<string, number>([[productLabel(selected, design), 1]])
    return others.map(p => {
      const label = productLabel(p, design)
      const n = (seen.get(label) ?? 0) + 1
      seen.set(label, n)
      return n > 1 ? `${label} (${n})` : label
    })
  })()
  const intended = isIntended(selected)
  const tags = tagsOf(selected)

  return (
    <div className="cw-outcome">
      {fidelity && (
        <div className={`cw-fidelity ${fidelity.score < 0.95 ? 'poor' : ''}`}>
          <span className="cw-fidelity-score">{(fidelity.score * 100).toFixed(0)}%</span>
          <span className="cw-fidelity-text">
            of ligations should join the intended parts{fidelity.notes.length > 0 ? ':' : '.'}
          </span>
          {fidelity.notes.length > 0 && <ul>{fidelity.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        </div>
      )}

      {!hasIntended && (
        <Diagnosis
          title="The construct does not form"
          problems={whyNoConstruct(products, design)}
          fixes={fixes}
          onFix={onFix}
        />
      )}

      <div
        className={`cw-result-card ${intended ? 'intended' : ''}`}
        onDoubleClick={() => onOpen(selected)}
        title="Double-click to open as a sequence"
      >
        <div className="cw-result-head">
          {intended ? <CircleCheck size={16} className="cw-result-icon" /> : null}
          <span className="cw-result-label">{productLabel(selected, design)}</span>
          <span className="cw-result-size">{formatBp(selected.size)} {selected.topology}</span>
        </div>
        <div className="cw-result-name">{selected.name}</div>
        {tags.length > 0 && (
          <div className="cw-product-tags">
            {tags.map(tag => <span key={tag.text} className={`cw-tag ${tag.tone}`}>{tag.text}</span>)}
          </div>
        )}
        {selected.warnings.length > 0 && (
          <ul className="cw-product-warnings">
            {selected.warnings.map((w, i) => <li key={i}><TriangleAlert size={12} />{w}</li>)}
          </ul>
        )}
      </div>

      {others.length > 0 && (
        <div className="cw-others">
          <button
            className="cw-others-toggle"
            onClick={() => setShowOthers(s => !s)}
            aria-expanded={showOthers}
          >
            <ChevronRight size={14} className="cw-chevron" />
            {others.length} other product{others.length === 1 ? '' : 's'} in the tube
          </button>
          {showOthers && (
            <ul className="cw-others-list">
              {others.map((product, i) => (
                <li key={productKey(product)}>
                  <button
                    className="cw-other"
                    onClick={() => onSelect(productKey(product))}
                    onDoubleClick={() => onOpen(product)}
                    title="Click to look at it, double-click to open as a sequence"
                  >
                    {isIntended(product) && <CircleCheck size={13} className="cw-result-icon" />}
                    <span className="cw-other-label">{otherLabels[i]}</span>
                    <span className="cw-other-size">{formatBp(product.size)} {product.topology}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {warningList}
    </div>
  )
}
