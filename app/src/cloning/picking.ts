/**
 * What a click on a part's map does to the design.
 *
 * Clicking sites works the way SnapGene's Insert Fragment dialog does, minus
 * the need to know about Shift: the first click cuts at a site, the second
 * cuts at another as well (two sites cut out the piece between them), and a
 * third starts again from the site just clicked. Shift+click adds a site
 * whatever is already chosen, for the rare three-enzyme digest. A click on a
 * chosen site stops cutting there.
 *
 * A site stands for its enzyme: a digest cuts every site an enzyme has, so
 * choosing one BamHI site chooses them all. The map then shows them all as
 * chosen, which is what will happen in the tube.
 *
 * A click on the molecule away from a site chooses which piece of the digest
 * goes into the reaction: the one that point is on.
 */

import type { Fragment } from './fragment'
import { partEnzymes, type CloningDesign, type DesignPart } from './design'

/** The part's enzymes after a click on a site cut by `siteEnzymes`. */
export function pickSite(
  part: DesignPart,
  design: CloningDesign,
  siteEnzymes: readonly string[],
  additive: boolean,
): string[] {
  const current = partEnzymes(part, design)
  const here = new Set(siteEnzymes.map(n => n.toLowerCase()))
  if (current.some(n => here.has(n.toLowerCase()))) {
    return current.filter(n => !here.has(n.toLowerCase()))
  }
  const enzyme = siteEnzymes[0]
  if (additive || current.length < 2) return [...current, enzyme]
  return [enzyme]
}

/** What clicking a site will do, in a few words, for its hover card. */
export function siteHint(
  part: DesignPart,
  design: CloningDesign,
  siteEnzymes: readonly string[],
): string {
  const current = partEnzymes(part, design)
  const here = new Set(siteEnzymes.map(n => n.toLowerCase()))
  if (current.some(n => here.has(n.toLowerCase()))) return 'Click to stop cutting here'
  if (current.length === 0) return 'Click to cut here'
  if (current.length === 1) return 'Click to cut here too'
  return 'Click to cut here instead, Shift+click to add it'
}

/** Whether a fragment of a part covers `pos` on the part. */
function covers(f: Fragment, pos: number, length: number): boolean {
  const { start, end } = f.source
  if (f.top.length >= length) return true
  return start < end ? pos >= start && pos < end : pos >= start || pos < end
}

/**
 * The piece of a part's digest that `pos` is on, as a `keep`. Null when the
 * part was not cut there, or was cut only once (one piece, nothing to pick).
 */
export function pieceAt(
  partId: string,
  fragments: readonly Fragment[],
  pos: number,
  length: number,
): { start: number; end: number } | null {
  const own = fragments.filter(f => f.id.startsWith(`${partId}:`) && f.topology === 'linear')
  if (own.length < 2) return null
  const hit = own.find(f => covers(f, pos, length))
  return hit ? { start: hit.source.start, end: hit.source.end } : null
}
