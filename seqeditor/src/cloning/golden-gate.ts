/**
 * Golden Gate Assembly simulation.
 *
 * Digests source sequences with a Type IIS enzyme, extracts insert fragments
 * (discarding backbone pieces that contain the recognition site), and assembles
 * based on 4bp overhang compatibility.
 */

import type { RestrictionEnzyme } from '../enzymes/db'
import { recognitionToRegex } from '../enzymes/db'
import { reverseComplement } from '../models/complement'
import type { DocumentState } from '../models/Document'
import type { CloningFragment, CloningProduct } from './types'
import { digestFragments, areOverhangsCompatible, type Overhang } from './digest'
import { productName, productDescription } from './naming'

export interface GoldenGateInput {
  sources: { doc: DocumentState }[]
  enzyme: RestrictionEnzyme
}

export interface GoldenGateResult {
  products: CloningProduct[]
  warnings: string[]
  /** All fragments after digest (before filtering backbones). */
  allFragments: CloningFragment[]
  /** Insert fragments (backbone removed). */
  insertFragments: CloningFragment[]
}

/**
 * Check if a fragment contains the enzyme recognition site (i.e., is a backbone piece).
 */
function isBackboneFragment(fragment: CloningFragment, enzyme: RestrictionEnzyme): boolean {
  const pattern = new RegExp(recognitionToRegex(enzyme.recognition), 'i')
  if (pattern.test(fragment.sequence)) return true
  // Also check reverse complement of recognition site
  const rc = reverseComplement(enzyme.recognition.toUpperCase())
  const rcPattern = new RegExp(recognitionToRegex(rc), 'i')
  return rcPattern.test(fragment.sequence)
}

/**
 * Check if a 4bp overhang is palindromic (self-complementary).
 */
function isPalindromicOverhang(seq: string): boolean {
  return seq.toUpperCase() === reverseComplement(seq.toUpperCase())
}

// ---------------------------------------------------------------------------
// Overhang fidelity scoring
// ---------------------------------------------------------------------------

/**
 * Known low-fidelity 4bp overhang pairs that frequently cross-react in
 * T4 ligase-based Golden Gate assemblies. Based on published NEB ligase
 * fidelity data (Potapov et al., 2018, ACS Synth Biol).
 *
 * Each entry is a pair of overhangs known to mis-ligate at >1% frequency.
 * Overhangs are stored as uppercase sense-strand sequences.
 */
const LOW_FIDELITY_PAIRS: [string, string][] = [
  ['AACG', 'AACG'], // self-misligation
  ['AAGT', 'AAGT'],
  ['ATAG', 'ATAC'],
  ['GGAG', 'GGAC'],
  ['TACA', 'TACT'],
  ['TTAC', 'TTAG'],
  ['AATG', 'AACG'],
  ['GATA', 'GACA'],
  ['GAGC', 'GACC'],
  ['TGTG', 'TGCG'],
  ['ACTC', 'ACCC'],
  ['GCAA', 'GCGA'],
]

/**
 * Score an overhang for fidelity. Returns 'high', 'medium', or 'low'.
 * - 'low': the overhang is palindromic or appears in the low-fidelity pair list
 * - 'medium': the overhang has low GC content or repeated bases
 * - 'high': no known issues
 */
export function scoreOverhangFidelity(
  overhang: string,
  allOverhangs: string[],
): 'high' | 'medium' | 'low' {
  const oh = overhang.toUpperCase()

  // Palindromic overhangs are always low fidelity
  if (isPalindromicOverhang(oh)) return 'low'

  // Check against known low-fidelity pairs
  for (const other of allOverhangs) {
    const oth = other.toUpperCase()
    if (oh === oth) continue // same overhang is fine (it's the intended match)
    for (const [a, b] of LOW_FIDELITY_PAIRS) {
      if ((oh === a && oth === b) || (oh === b && oth === a)) return 'low'
      // Also check reverse complements
      const rcOh = reverseComplement(oh)
      const rcOth = reverseComplement(oth)
      if ((rcOh === a && rcOth === b) || (rcOh === b && rcOth === a)) return 'low'
    }
  }

  // Medium: all-same base (AAAA, TTTT, etc.) or only 1 unique base type
  const unique = new Set(oh.split('')).size
  if (unique === 1) return 'medium'

  // Medium: 3+ of the same base (e.g., AAAG)
  const counts = new Map<string, number>()
  for (const c of oh) counts.set(c, (counts.get(c) ?? 0) + 1)
  for (const count of counts.values()) {
    if (count >= 3) return 'medium'
  }

  return 'high'
}

/**
 * Check all overhangs in a Golden Gate assembly for fidelity issues.
 */
function checkOverhangFidelity(overhangs: string[]): string[] {
  const warnings: string[] = []
  const unique = [...new Set(overhangs.map(o => o.toUpperCase()))]

  for (const oh of unique) {
    const score = scoreOverhangFidelity(oh, unique)
    if (score === 'low') {
      warnings.push(`Overhang ${oh} has low ligation fidelity – may cause mis-assembly`)
    } else if (score === 'medium') {
      warnings.push(`Overhang ${oh} has moderate ligation fidelity – consider alternatives`)
    }
  }

  return warnings
}

/**
 * Simulate Golden Gate Assembly.
 */
export function goldenGateAssemble(input: GoldenGateInput): GoldenGateResult {
  const warnings: string[] = []

  if (input.sources.length === 0) {
    return { products: [], warnings: ['No source sequences provided'], allFragments: [], insertFragments: [] }
  }

  // Digest all sources with the Type IIS enzyme
  const allFragments: CloningFragment[] = []
  for (const source of input.sources) {
    const digest = digestFragments(source.doc, [input.enzyme])
    allFragments.push(...digest.fragments)
    warnings.push(...digest.warnings)
  }

  if (allFragments.length <= input.sources.length) {
    // Each source produced at most 1 fragment – no cuts found
    warnings.push(`No ${input.enzyme.name} sites found in the source sequences`)
    return { products: [], warnings, allFragments, insertFragments: [] }
  }

  // Separate inserts from backbones
  const insertFragments = allFragments.filter(f => !isBackboneFragment(f, input.enzyme))

  if (insertFragments.length === 0) {
    warnings.push('All fragments contain the enzyme recognition site – no inserts found')
    return { products: [], warnings, allFragments, insertFragments }
  }

  // Validate overhangs
  const overhangMap = new Map<string, { frag: CloningFragment; end: '5' | '3' }[]>()

  for (const frag of insertFragments) {
    // Track 5' overhang
    if (frag.overhang5Type !== 'blunt' && frag.overhang5.length > 0) {
      const key = frag.overhang5.toUpperCase()
      if (!overhangMap.has(key)) overhangMap.set(key, [])
      overhangMap.get(key)!.push({ frag, end: '5' })
    }
    // Track 3' overhang
    if (frag.overhang3Type !== 'blunt' && frag.overhang3.length > 0) {
      const key = frag.overhang3.toUpperCase()
      if (!overhangMap.has(key)) overhangMap.set(key, [])
      overhangMap.get(key)!.push({ frag, end: '3' })
    }
  }

  // Check for palindromic overhangs
  for (const [seq] of overhangMap) {
    if (isPalindromicOverhang(seq)) {
      warnings.push(`Palindromic overhang ${seq} – may cause self-ligation or ambiguous assembly`)
    }
  }

  // Check for duplicate overhangs (same overhang on same end type in multiple fragments)
  for (const [seq, entries] of overhangMap) {
    const fiveCount = entries.filter(e => e.end === '5').length
    const threeCount = entries.filter(e => e.end === '3').length
    if (fiveCount > 1) {
      warnings.push(`Duplicate 5' overhang ${seq} on ${fiveCount} fragments – ambiguous assembly`)
    }
    if (threeCount > 1) {
      warnings.push(`Duplicate 3' overhang ${seq} on ${threeCount} fragments – ambiguous assembly`)
    }
  }

  // Check overhang fidelity (cross-reactivity between overhang pairs)
  const allOverhangSeqs = [...overhangMap.keys()]
  warnings.push(...checkOverhangFidelity(allOverhangSeqs))

  // Assemble: build a directed graph where fragment A → fragment B if A's 3' overhang
  // is compatible with B's 5' overhang
  const n = insertFragments.length
  const adj = new Map<number, number[]>()

  for (let i = 0; i < n; i++) {
    const oh3: Overhang = {
      sequence: insertFragments[i].overhang3,
      type: insertFragments[i].overhang3Type,
    }
    const compatible: number[] = []
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const oh5: Overhang = {
        sequence: insertFragments[j].overhang5,
        type: insertFragments[j].overhang5Type,
      }
      if (areOverhangsCompatible(oh3, oh5)) {
        compatible.push(j)
      }
    }
    adj.set(i, compatible)
  }

  // DFS to find circular assemblies (Golden Gate produces circular products)
  const products: CloningProduct[] = []
  const MAX_PRODUCTS = 20
  const used = new Set<number>()

  function dfs(path: number[]) {
    if (products.length >= MAX_PRODUCTS) return
    const last = path[path.length - 1]
    const first = path[0]

    // Check if we can close the circle
    if (path.length >= 2) {
      const oh3Last: Overhang = {
        sequence: insertFragments[last].overhang3,
        type: insertFragments[last].overhang3Type,
      }
      const oh5First: Overhang = {
        sequence: insertFragments[first].overhang5,
        type: insertFragments[first].overhang5Type,
      }
      if (areOverhangsCompatible(oh3Last, oh5First)) {
        products.push(buildGoldenGateProduct(path, insertFragments))
      }
    }

    // Extend
    const nexts = adj.get(last) ?? []
    for (const next of nexts) {
      if (used.has(next)) continue
      if (products.length >= MAX_PRODUCTS) return
      used.add(next)
      path.push(next)
      dfs(path)
      path.pop()
      used.delete(next)
    }
  }

  for (let i = 0; i < n; i++) {
    if (products.length >= MAX_PRODUCTS) break
    used.clear()
    used.add(i)
    dfs([i])
  }

  // Deduplicate rotational equivalents
  const deduped = deduplicateCircular(products)

  // Mark expected: circular products using all insert fragments
  for (const p of deduped) {
    const fragCount = p.description.split(' + ').length
    if (fragCount === n) {
      p.isExpected = true
    }
  }

  // Check for unmatched overhangs
  if (deduped.length === 0) {
    const unmatched: string[] = []
    for (let i = 0; i < n; i++) {
      const oh3: Overhang = {
        sequence: insertFragments[i].overhang3,
        type: insertFragments[i].overhang3Type,
      }
      const hasMatch = (adj.get(i) ?? []).length > 0
      if (!hasMatch) {
        unmatched.push(`${insertFragments[i].name} 3' overhang (${oh3.sequence})`)
      }
    }
    if (unmatched.length > 0) {
      warnings.push(`Unmatched overhangs: ${unmatched.join(', ')}`)
    }
    warnings.push('No circular assembly possible with the given fragments')
  }

  deduped.sort((a, b) => {
    if (a.isExpected !== b.isExpected) return a.isExpected ? -1 : 1
    return b.size - a.size
  })

  return { products: deduped, warnings, allFragments, insertFragments }
}

function buildGoldenGateProduct(
  path: number[],
  fragments: CloningFragment[],
): CloningProduct {
  let sequence = ''
  const allAnnotations: import('../models/Annotation').AnnotationData[] = []

  for (const idx of path) {
    const frag = fragments[idx]
    const offset = sequence.length
    sequence += frag.sequence

    for (const ann of frag.annotations) {
      allAnnotations.push({
        ...ann,
        id: `${ann.id}_gg_${idx}`,
        start: ann.start + offset,
        end: ann.end + offset,
      })
    }
  }

  const fragsInPath = path.map(i => fragments[i])
  return {
    name: productName(fragsInPath),
    sequence,
    topology: 'circular',
    annotations: allAnnotations,
    size: sequence.length,
    isExpected: false,
    description: productDescription('Golden Gate assembly', fragsInPath),
  }
}

function deduplicateCircular(products: CloningProduct[]): CloningProduct[] {
  const seen = new Set<string>()
  const result: CloningProduct[] = []
  for (const p of products) {
    const canon = canonicalRotation(p.sequence)
    if (seen.has(canon)) continue
    seen.add(canon)
    result.push(p)
  }
  return result
}

function canonicalRotation(s: string): string {
  const n = s.length
  if (n === 0) return s
  const ss = s + s
  const f = new Array(2 * n).fill(-1)
  let k = 0
  for (let j = 1; j < 2 * n; j++) {
    let i = f[j - 1 - k]
    while (i !== -1 && ss[j] !== ss[k + i + 1]) {
      if (ss[j] < ss[k + i + 1]) k = j - i - 1
      i = f[i]
    }
    if (i === -1 && ss[j] !== ss[k + i + 1]) {
      if (ss[j] < ss[k + i + 1]) k = j
      f[j - k] = -1
    } else {
      f[j - k] = i + 1
    }
  }
  return ss.slice(k, k + n)
}
