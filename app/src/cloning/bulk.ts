/**
 * Cloning many constructs at once.
 *
 * A bulk design is the same design with alternatives at one or more
 * positions. Each position is a bin — a vector, a promoter, a set of coding
 * sequences — and every way of taking one part from each bin is a
 * combination that gets run through the ordinary engines (./run).
 *
 * A vector against a list of inserts is a two-bin design, so the matrix
 * people usually want is a special case of this rather than its own thing.
 */

import type { Assembly } from './product'
import {
  partLength,
  vectorsFirst,
  type CloningDesign,
  type DesignPart,
} from './design'
import { productKey, runDesign, selectedProduct, type RunResult } from './run'

export interface DesignBin {
  id: string
  /** What this position is for: "Vector", "Promoter", "CDS". */
  name: string
  /** The alternatives. One is taken per combination. */
  parts: DesignPart[]
}

/** How a combination turned out, at a glance. */
export type BulkVerdict = 'ok' | 'ambiguous' | 'none'

export interface BulkRow {
  /** Index of the chosen part within each bin, in bin order. */
  choice: number[]
  /** The chosen parts' names, in bin order. */
  partNames: string[]
  name: string
  verdict: BulkVerdict
  size: number
  topology: 'linear' | 'circular' | null
  /** The product, when one formed. Absent rows still carry their reason. */
  product?: Assembly
  /** Why there is no product, or what to watch out for in the one there is. */
  notes: string[]
  /** Type IIS only: how well the overhangs tell themselves apart, 0–1. */
  fidelity?: number
}

export interface BulkResult {
  rows: BulkRow[]
  /** How many combinations the bins describe, before any cap. */
  total: number
  /** True when the cap stopped it short of `total`. */
  truncated: boolean
  binNames: string[]
}

export interface BulkOptions {
  /**
   * Name for each construct. `{1}`…`{9}` are the chosen parts' names by bin,
   * `{#}` is the row number, and anything else is used as written. Left out,
   * the product names itself the way a single design would.
   */
  nameTemplate?: string
  /** Stop after this many combinations. Default 500. */
  limit?: number
  onProgress?: (done: number, total: number) => void
  /** Checked between combinations so a long run can be stopped. */
  shouldStop?: () => boolean
}

/** How many constructs a set of bins describes. */
export function combinationCount(bins: readonly DesignBin[]): number {
  if (bins.length === 0) return 0
  let total = 1
  for (const bin of bins) {
    if (bin.parts.length === 0) return 0
    total *= bin.parts.length
    // Past this there is no point counting exactly; it is far too many.
    if (total > 1e6) return 1e6
  }
  return total
}

/** The choice of parts for combination `index`, as an index per bin. */
function choiceAt(bins: readonly DesignBin[], index: number): number[] {
  const choice: number[] = []
  let rest = index
  for (let i = bins.length - 1; i >= 0; i--) {
    const size = bins[i].parts.length
    choice[i] = rest % size
    rest = Math.floor(rest / size)
  }
  return choice
}

/** Fill a naming template, or fall back to what the engine called it. */
export function buildName(
  template: string | undefined,
  partNames: readonly string[],
  row: number,
  fallback: string,
): string {
  if (!template || !template.trim()) return fallback
  return template.replace(/\{(#|\d)\}/g, (match, token: string) => {
    if (token === '#') return String(row)
    const index = Number(token) - 1
    return partNames[index] ?? match
  })
}

/** What to say about a combination that worked, or did not. */
function notesFor(result: RunResult, product: Assembly | null): string[] {
  if (!product) return result.problems.length > 0 ? result.problems : result.warnings.slice(0, 2)
  const notes = [...product.warnings]
  if (product.recut.length > 0) notes.push(`Cut again by ${product.recut.join(', ')}`)
  if (product.nicked) notes.push('One strand is left nicked at a junction')
  if (product.parts.some(p => p.reversed)) notes.push('A part goes in flipped')
  return notes
}

function verdictFor(product: Assembly | null): BulkVerdict {
  if (!product) return 'none'
  return product.usesAll && product.topology === 'circular' && product.recut.length === 0
    ? 'ok'
    : 'ambiguous'
}

/**
 * Run every combination the bins describe.
 *
 * Combinations are run one at a time rather than all at once so a long run
 * can report progress and be stopped: a few hundred constructs is normal for
 * a library, and each one is a full assembly.
 */
export function runBulk(
  design: CloningDesign,
  bins: readonly DesignBin[],
  options: BulkOptions = {},
): BulkResult {
  const limit = options.limit ?? 500
  const total = combinationCount(bins)
  const binNames = bins.map(b => b.name)

  if (total === 0) return { rows: [], total: 0, truncated: false, binNames }

  const count = Math.min(total, limit)
  const rows: BulkRow[] = []

  for (let i = 0; i < count; i++) {
    if (options.shouldStop?.()) break
    const choice = choiceAt(bins, i)
    const parts = choice.map((pick, bin) => bins[bin].parts[pick])
    const partNames = parts.map(p => p.name)

    const result = runDesign({ ...design, parts: vectorsFirst(parts) })
    const product = selectedProduct({ ...design, selected: undefined as string | undefined }, result.products)

    rows.push({
      choice,
      partNames,
      name: buildName(options.nameTemplate, partNames, i + 1, product?.name ?? partNames.join(' + ')),
      verdict: verdictFor(product),
      size: product?.size ?? 0,
      topology: product?.topology ?? null,
      ...(product ? { product } : {}),
      notes: notesFor(result, product),
      ...(result.fidelity ? { fidelity: result.fidelity.score } : {}),
    })

    options.onProgress?.(i + 1, count)
  }

  return { rows, total, truncated: total > count, binNames }
}

/** A bin holding one part, for a position with no alternatives. */
export function binOf(part: DesignPart, name?: string): DesignBin {
  return { id: `bin_${part.id}`, name: name ?? part.name, parts: [part] }
}

/**
 * Bins from a design's own parts: one per part, each with that part as its
 * only choice. This is the starting point when turning a single design into
 * a library — the user then adds alternatives to whichever positions vary.
 */
export function binsFromDesign(design: CloningDesign): DesignBin[] {
  return vectorsFirst(design.parts).map(part =>
    binOf(part, part.role === 'vector' ? 'Vector' : part.name),
  )
}

/** Totals for the summary line above a results table. */
export function summarise(rows: readonly BulkRow[]): { ok: number; ambiguous: number; none: number } {
  let ok = 0
  let ambiguous = 0
  let none = 0
  for (const row of rows) {
    if (row.verdict === 'ok') ok++
    else if (row.verdict === 'ambiguous') ambiguous++
    else none++
  }
  return { ok, ambiguous, none }
}

/** Rough guide to how long a run will take, for warning before a big one. */
export function estimateWork(bins: readonly DesignBin[]): number {
  const count = combinationCount(bins)
  const parts = bins.reduce((n, bin) => n + bin.parts.length, 0)
  const bases = bins.reduce(
    (n, bin) => n + bin.parts.reduce((m, p) => m + partLength(p), 0),
    0,
  )
  return count * Math.max(1, Math.round((bases / Math.max(parts, 1)) / 1000))
}

/** The key a chosen product is remembered by, so a row survives a re-run. */
export function rowKey(row: BulkRow): string {
  return row.product ? productKey(row.product) : row.choice.join('-')
}
