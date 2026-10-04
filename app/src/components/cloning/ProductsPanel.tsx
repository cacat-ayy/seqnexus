/**
 * What the reaction gives, and what to do with it.
 *
 * The product the design is for comes first and is marked as such; everything
 * else a real tube would also contain follows, because knowing that the
 * vector will mostly religate is worth as much as knowing the construct can
 * form. When nothing forms at all, this panel says why instead of showing an
 * empty list — that is the question people actually have.
 */

import { CircleCheck, CircleSlash, Info, TriangleAlert } from 'lucide-react'
import type { Assembly } from '../../cloning/product'
import { productKey } from '../../cloning/run'

interface Props {
  products: Assembly[]
  selectedKey: string | null
  problems: string[]
  warnings: string[]
  fidelity?: { score: number; notes: string[] }
  onSelect: (key: string) => void
  onOpen: (product: Assembly) => void
}

function formatBp(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} kb` : `${n} bp`
}

/** What marks a product out, in the order worth saying it. */
function tagsOf(product: Assembly): { text: string; tone: 'good' | 'warn' | 'plain' }[] {
  const tags: { text: string; tone: 'good' | 'warn' | 'plain' }[] = []
  if (product.usesAll && product.topology === 'circular' && product.recut.length === 0) {
    tags.push({ text: 'the one you want', tone: 'good' })
  }
  if (product.recut.length > 0) tags.push({ text: `cut again by ${product.recut.join(', ')}`, tone: 'warn' })
  if (product.topology === 'linear') tags.push({ text: 'linear', tone: 'plain' })
  if (product.nicked) tags.push({ text: 'nicked', tone: 'plain' })
  if (product.parts.some(p => p.reversed)) tags.push({ text: 'a part is flipped', tone: 'plain' })
  return tags
}

export default function ProductsPanel({
  products,
  selectedKey,
  problems,
  warnings,
  fidelity,
  onSelect,
  onOpen,
}: Props) {
  if (products.length === 0) {
    return (
      <div className="cw-products">
        <div className="cw-nothing">
          <CircleSlash size={16} />
          <h4>Nothing assembles yet</h4>
          {problems.length > 0
            ? <ul>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
            : <p>Add the parts and choose how they should be joined.</p>}
        </div>
        {warnings.length > 0 && (
          <ul className="cw-warnings">
            {warnings.map((w, i) => <li key={i}><TriangleAlert size={12} />{w}</li>)}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="cw-products">
      {fidelity && (
        <div className={`cw-fidelity ${fidelity.score < 0.95 ? 'poor' : ''}`}>
          <span className="cw-fidelity-score">{(fidelity.score * 100).toFixed(0)}%</span>
          <span className="cw-fidelity-text">
            of ligations should join the intended parts
            {fidelity.notes.length > 0 ? ':' : '.'}
          </span>
          {fidelity.notes.length > 0 && (
            <ul>{fidelity.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          )}
        </div>
      )}

      <ul className="cw-product-list">
        {products.map(product => {
          const key = productKey(product)
          const tags = tagsOf(product)
          return (
            <li key={key}>
              <button
                className={`cw-product ${key === selectedKey ? 'selected' : ''}`}
                onClick={() => onSelect(key)}
                onDoubleClick={() => onOpen(product)}
              >
                <span className="cw-product-head">
                  <span className="cw-product-name">{product.name}</span>
                  <span className="cw-product-size">{formatBp(product.size)}</span>
                </span>
                <span className="cw-product-tags">
                  {tags.map(tag => (
                    <span key={tag.text} className={`cw-tag ${tag.tone}`}>
                      {tag.tone === 'good' && <CircleCheck size={11} />}
                      {tag.text}
                    </span>
                  ))}
                </span>
                {product.warnings.length > 0 && (
                  <span className="cw-product-warnings">
                    {product.warnings.map((w, i) => (
                      <span key={i}><TriangleAlert size={11} />{w}</span>
                    ))}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      {warnings.length > 0 && (
        <ul className="cw-warnings">
          {warnings.map((w, i) => <li key={i}><Info size={12} />{w}</li>)}
        </ul>
      )}
    </div>
  )
}
