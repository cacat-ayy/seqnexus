/**
 * The middle of the workspace for one construct: a tab per part and one for
 * the product, each a real map, with the reaction strip underneath.
 *
 * This is SnapGene's Insert Fragment dialog laid out as tabs. On a part's tab
 * you choose where it is cut by clicking sites, and which piece goes in by
 * clicking the molecule. On the product's tab you see what comes out, drawn
 * like any other plasmid, with each part's contribution marked on the
 * backbone in that part's colour.
 */

import { useMemo } from 'react'
import { RotateCcw } from 'lucide-react'
import type { Assembly } from '../../cloning/product'
import type { RunResult } from '../../cloning/run'
import { isIntended, missingPart, productLabel, keptFragment, type DesignFix } from '../../cloning/outcome'
import { mapSites, type MapSite } from '../../cloning/sites'
import { pickSite, pieceAt, siteHint } from '../../cloning/picking'
import {
  partBases,
  partEnzymes,
  partTopology,
  vectorsFirst,
  type CloningDesign,
  type DesignPart,
} from '../../cloning/design'
import CloneMap, { type MapRegion } from './CloneMap'
import EndsStrip, { type StripPiece } from './EndsStrip'
import ProductsPanel from './ProductsPanel'
import { partColor } from './colors'
import { formatBp } from '../../utils/format'

interface Props {
  design: CloningDesign
  result: RunResult
  chosen: Assembly | null
  fixes: DesignFix[]
  tab: string
  onTab: (tab: string) => void
  onPart: (id: string, changes: Partial<DesignPart>) => void
  onSelectProduct: (key: string) => void
  onOpenProduct: (product: Assembly) => void
  onFix: (fix: DesignFix) => void
}

const EMPTY_SET: ReadonlySet<string> = new Set()

/** The enzymes a design cuts with, for marking the junctions on the product. */
function usedEnzymes(design: CloningDesign): string[] {
  if (design.method === 'golden-gate') return [design.typeIIS]
  if (design.method !== 'restriction') return []
  return [...new Set(design.parts.flatMap(p => partEnzymes(p, design)))]
}

export default function MapStage({
  design, result, chosen, fixes, tab, onTab, onPart, onSelectProduct, onOpenProduct, onFix,
}: Props) {
  const cut = design.method === 'restriction' || design.method === 'golden-gate'
  const part = design.parts.find(p => p.id === tab) ?? null
  const index = part ? design.parts.indexOf(part) : -1

  const pieces = useMemo((): StripPiece[] => vectorsFirst(design.parts).map(p => ({
    part: p,
    fragment: keptFragment(p, result.fragments),
    index: design.parts.indexOf(p),
  })), [design.parts, result.fragments])

  return (
    <div className="cw-stage">
      <div className="cw-tabs" role="tablist" aria-label="Maps">
        {design.parts.map((p, i) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={tab === p.id}
            className={`panel-tab cw-tab ${tab === p.id ? 'active' : ''}`}
            onClick={() => onTab(p.id)}
          >
            <span className="cw-tab-swatch" style={{ background: partColor(i) }} aria-hidden="true" />
            <span className="cw-tab-name">{p.name}</span>
            <span className="cw-tab-role">{p.role}</span>
          </button>
        ))}
        <button
          role="tab"
          aria-selected={tab === 'product'}
          className={`panel-tab cw-tab cw-tab-product ${tab === 'product' ? 'active' : ''}`}
          onClick={() => onTab('product')}
        >
          <span className={`cw-tab-dot ${chosen && isIntended(chosen) ? 'ok' : chosen ? 'partial' : 'none'}`} aria-hidden="true" />
          Product
        </button>
      </div>

      {part ? (
        <PartView design={design} result={result} part={part} index={index} onPart={onPart} />
      ) : (
        <ProductView design={design} product={chosen} />
      )}

      {cut && design.parts.length > 0 && (
        <EndsStrip pieces={pieces} product={chosen} selected={tab} onSelect={onTab} />
      )}

      {!part && design.parts.length > 0 && (
        <div className="cw-result">
          <ProductsPanel
            design={design}
            products={result.products}
            selected={chosen}
            problems={result.problems}
            warnings={result.warnings}
            fixes={fixes}
            {...(result.fidelity ? { fidelity: result.fidelity } : {})}
            onSelect={onSelectProduct}
            onOpen={onOpenProduct}
            onFix={onFix}
          />
        </div>
      )}
    </div>
  )
}

function PartView({ design, result, part, index, onPart }: {
  design: CloningDesign
  result: RunResult
  part: DesignPart
  index: number
  onPart: (id: string, changes: Partial<DesignPart>) => void
}) {
  const bases = partBases(part)
  const topology = partTopology(part)
  const restriction = design.method === 'restriction'
  const goldenGate = design.method === 'golden-gate'
  const chosenEnzymes = restriction ? partEnzymes(part, design) : goldenGate ? [design.typeIIS] : []

  const { sites, picked } = useMemo(() => {
    if (!restriction && !goldenGate) return { sites: [] as MapSite[], picked: EMPTY_SET }
    return mapSites({
      bases,
      topology,
      ...(part.damMethylated ? { damMethylated: true } : {}),
      ...(part.dcmMethylated ? { dcmMethylated: true } : {}),
      extra: restriction ? design.enzymes : [design.typeIIS],
      chosen: chosenEnzymes,
      // Golden Gate's enzyme is fixed by the method; there is nothing to browse.
      onlyNamed: goldenGate,
    })
    // chosenEnzymes is derived from the design and the part, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bases, topology, part.damMethylated, part.dcmMethylated, part.enzymes, design.enzymes, design.typeIIS, restriction, goldenGate])

  const kept = restriction || goldenGate ? keptFragment(part, result.fragments) : null
  const pieceCount = result.fragments.filter(f => f.id.startsWith(`${part.id}:`) && f.topology === 'linear').length

  const regions = useMemo((): MapRegion[] => {
    if (!kept) return []
    const { start } = kept.source
    // Cut once, a circle opens into one piece that is all of it.
    const end = kept.top.length >= bases.length ? (start + bases.length - 1) % bases.length : kept.source.end
    return [{ start, end, color: partColor(index) }]
  }, [kept, bases.length, index])

  const note = !kept
    ? (chosenEnzymes.length === 0 ? 'Click a site to cut' : 'Not cut')
    : pieceCount === 1
      ? `Opened, all ${formatBp(kept.top.length)}`
      : `Uses ${formatBp(kept.top.length)} of ${pieceCount} pieces`

  const hint = restriction
    ? 'Click a site to cut there, and a second to cut out the piece between them. Click the map to use the other piece.'
    : goldenGate
      ? `${design.typeIIS} cuts where it is marked. Click the map to use a different piece.`
      : null

  return (
    <>
      <div className="cw-map">
        <CloneMap
          name={part.name}
          bases={bases}
          topology={topology}
          annotations={part.annotations}
          sites={sites}
          picked={picked}
          regions={regions}
          note={note}
          {...(restriction ? {
            onSite: (site: MapSite, additive: boolean) => {
              // The pieces change with the cuts, so a piece chosen before means nothing now.
              onPart(part.id, { enzymes: pickSite(part, design, site.enzymes, additive), keep: undefined })
            },
            siteHint: (site: MapSite) => siteHint(part, design, site.enzymes),
          } : {})}
          {...(restriction || goldenGate ? {
            onPosition: (pos: number) => {
              const keep = pieceAt(part.id, result.fragments, pos, bases.length)
              if (keep) onPart(part.id, { keep })
            },
          } : {})}
        />
      </div>
      {hint && (
        <div className="cw-maphint">
          <span>{hint}</span>
          {restriction && part.enzymes !== undefined && (
            <button
              className="cw-btn"
              onClick={() => onPart(part.id, { enzymes: undefined, keep: undefined })}
              title={design.enzymes.length > 0
                ? `Cut ${part.name} with ${design.enzymes.join(' + ')}, like the parts without sites of their own`
                : 'Forget the sites picked here'}
            >
              <RotateCcw size={12} /> {design.enzymes.length > 0 ? 'Use the design’s enzymes' : 'Clear sites'}
            </button>
          )}
        </div>
      )}
    </>
  )
}

function ProductView({ design, product }: { design: CloningDesign; product: Assembly | null }) {
  const enzymes = useMemo(() => usedEnzymes(design), [design])
  const { sites, picked } = useMemo(() => {
    if (!product) return { sites: [] as MapSite[], picked: EMPTY_SET }
    return mapSites({
      bases: product.sequence,
      topology: product.topology,
      extra: enzymes,
      chosen: enzymes,
    })
  }, [product, enzymes])

  // Each part's stretch of the product, on the backbone in the part's colour.
  const regions = useMemo((): MapRegion[] => {
    if (!product) return []
    return product.parts.map((piece, i) => {
      const owner = design.parts.findIndex(p => piece.fragmentId === p.id || piece.fragmentId.startsWith(`${p.id}:`))
      return { start: piece.start % product.size, end: piece.end % product.size, color: partColor(owner >= 0 ? owner : i) }
    })
  }, [product, design.parts])

  if (!product) {
    const missing = missingPart(design)
    return (
      <div className="cw-map cw-map-empty">
        <p>{design.parts.length === 0
          ? 'Add the sequences you are cloning and the product is drawn here.'
          : missing
            ? `Add ${missing} under Parts and the product is drawn here.`
            : 'Nothing forms yet. The reason is below.'}</p>
      </div>
    )
  }

  return (
    <div className="cw-map">
      <CloneMap
        name={product.name}
        bases={product.sequence}
        topology={product.topology}
        annotations={product.annotations}
        sites={sites}
        picked={picked}
        regions={regions}
        note={productLabel(product, design)}
        exportName={product.name}
      />
    </div>
  )
}
