/**
 * The cut sites drawn on a part's map in the cloning workspace.
 *
 * A map shows what can be clicked: every enzyme that cuts the part exactly
 * once, which is the set someone choosing where to open a vector looks at
 * first, plus every enzyme the design names, wherever and however often it
 * cuts. The enzymes the part is actually cut with are marked as chosen.
 *
 * The single cutters come from the commercial enzymes with a site of six or
 * more specified bases that cut inside or beside it, one name per specificity
 * (isoschizomers would otherwise stack two labels on one site). The curated
 * names win, so the map says BamHI rather than one of its isoschizomers.
 * Type IIS enzymes are left out of this set: they cut away from their site
 * and are chosen deliberately, for Golden Gate, not found by browsing.
 */

import { ENZYME_DB, getEnzyme, type RestrictionEnzyme } from '../enzymes/db'
import { cuttingSites, findCutSites, type CutSite } from '../enzymes/finder'
import { groupCutSites, enzymeGroupKey } from '../enzymes/grouping'

/** One mark on the map: the sites at one position, as the map groups them. */
export interface MapSite {
  key: string
  label: string
  /** Top-strand cut position. */
  cutPos: number
  /** Start of the recognition site, for the hover card. */
  position: number
  enzymes: string[]
  /** How many times the first enzyme here cuts the whole part. */
  cuts: number
  methEffect: 'blocked' | 'impaired' | null
}

let browseSet: RestrictionEnzyme[] | null = null

/** The enzymes whose single sites a map offers, one per specificity. */
export function mapEnzymes(): RestrictionEnzyme[] {
  if (browseSet) return browseSet
  const bySpecificity = new Map<string, RestrictionEnzyme>()
  for (const enzyme of ENZYME_DB) {
    if (enzyme.suppliers.length === 0) continue
    const len = enzyme.recognition.length
    if (len < 6) continue
    // Cuts inside or right beside its site; anything further is Type IIS.
    if (enzyme.fwd_cut < 0 || enzyme.fwd_cut > len || enzyme.rev_cut < 0 || enzyme.rev_cut > len) continue
    const key = `${enzyme.recognition.toUpperCase()}/${enzyme.fwd_cut}/${enzyme.rev_cut}`
    const held = bySpecificity.get(key)
    if (!held || better(enzyme, held)) bySpecificity.set(key, enzyme)
  }
  browseSet = [...bySpecificity.values()].sort((a, b) => a.name.localeCompare(b.name))
  return browseSet
}

/** The better-known of two isoschizomers: the one people clone with, then NEB's. */
function better(a: RestrictionEnzyme, b: RestrictionEnzyme): boolean {
  const known = (e: RestrictionEnzyme) => (CURATED.has(e.name) ? 2 : 0) + (e.suppliers.includes('NEB') ? 1 : 0)
  return known(a) > known(b)
}

/** The names people clone with, which a map should use for a shared site. */
const CURATED = new Set([
  'AatII', 'AccI', 'AflII', 'AgeI', 'ApaI', 'ApaLI', 'AscI', 'AvrII', 'BamHI', 'BclI', 'BglII',
  'BsiWI', 'BspEI', 'BsrGI', 'BstBI', 'BstEII', 'ClaI', 'EagI', 'EcoRI', 'EcoRV', 'FseI', 'HindIII',
  'HpaI', 'KpnI', 'MfeI', 'MluI', 'NcoI', 'NdeI', 'NheI', 'NotI', 'NsiI', 'PacI', 'PmeI', 'PstI',
  'PvuI', 'PvuII', 'SacI', 'SacII', 'SalI', 'SbfI', 'ScaI', 'SmaI', 'SnaBI', 'SpeI', 'SphI', 'StuI',
  'SwaI', 'XbaI', 'XhoI', 'XmaI', 'ZraI',
])

export interface SiteQuery {
  bases: string
  topology: 'linear' | 'circular'
  damMethylated?: boolean
  dcmMethylated?: boolean
  /** Shown wherever and however often they cut. */
  extra: readonly string[]
  /** The enzymes the part is cut with; their sites are marked chosen. */
  chosen: readonly string[]
  /** Leave out the single cutters and show only `extra` and `chosen`. */
  onlyNamed?: boolean
}

/** The marks for one part's map, and which of them are chosen. */
export function mapSites(q: SiteQuery): { sites: MapSite[]; picked: Set<string> } {
  const named = new Set([...q.extra, ...q.chosen].map(n => n.toLowerCase()))
  const all: CutSite[] = []
  const counts = new Map<string, number>()
  const consider = (enzyme: RestrictionEnzyme, force: boolean) => {
    const sites = cuttingSites(findCutSites(q.bases, enzyme, q.topology))
    if (sites.length === 0) return
    if (!force && sites.length !== 1) return
    counts.set(enzyme.name, sites.length)
    all.push(...sites)
  }

  const seen = new Set<string>()
  for (const name of named) {
    const enzyme = getEnzyme(name)
    if (!enzyme || seen.has(enzyme.name)) continue
    seen.add(enzyme.name)
    consider(enzyme, true)
  }
  if (!q.onlyNamed) {
    for (const enzyme of mapEnzymes()) {
      if (seen.has(enzyme.name)) continue
      seen.add(enzyme.name)
      consider(enzyme, false)
    }
  }
  // At one position the enzyme someone means comes first: a named one, then
  // one with an exact site (EcoRI before ApoI's RAATTY), since the first is
  // what the label leads with and what a click on the mark chooses.
  const rank = (s: CutSite) =>
    (named.has(s.enzyme.name.toLowerCase()) ? 0 : 2) + (/^[ACGT]+$/i.test(s.enzyme.recognition) ? 0 : 1)
  all.sort((a, b) =>
    a.position - b.position || rank(a) - rank(b) || a.enzyme.name.localeCompare(b.enzyme.name))

  // A site the host's methylation blocks is still drawn, faded, so the
  // reason it cannot be used is visible rather than the site going missing.
  const groups = groupCutSites(all, q.damMethylated ?? false, q.dcmMethylated ?? false)
  const chosen = new Set(q.chosen.map(n => n.toLowerCase()))
  const picked = new Set<string>()
  const sites = groups.map(g => {
    const key = enzymeGroupKey(g)
    const enzymes = g.sites.map(s => s.enzyme.name)
    if (enzymes.some(n => chosen.has(n.toLowerCase()))) picked.add(key)
    return {
      key,
      label: g.label,
      cutPos: g.fwdCut,
      position: g.recognitionStart,
      enzymes,
      cuts: counts.get(enzymes[0]) ?? 1,
      methEffect: g.methEffect,
    }
  })
  return { sites, picked }
}
