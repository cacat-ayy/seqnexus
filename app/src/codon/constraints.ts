/**
 * Sequence constraints for codon optimization.
 *
 * Everything the optimizer is asked to avoid compiles into one object with two
 * entry points: `violationsIn`, which the walk calls on the window it just
 * changed, and `findViolations`, which builds the report. Both run the same
 * checks, so the optimizer can never claim a constraint the report disagrees
 * with.
 *
 * Positions in results are indices into the sequence string handed in, which
 * for the optimizer includes the untouched flanking context. Callers translate
 * to genomic coordinates.
 */

import { ENZYME_DB, ENZYME_GROUPS, getEnzyme, recognitionToRegex } from '../enzymes/db'
import { reverseComplement } from '../models/complement'

export type ViolationKind =
  | 'motif'
  | 'homopolymer'
  | 'gc-global'
  | 'gc-window'
  | 'repeat'
  | 'hairpin'
  | 'cpg'

export interface Violation {
  kind: ViolationKind
  start: number
  end: number
  /** What to show the user: the motif name, the run, the measured GC. */
  detail: string
}

export interface MotifSpec {
  /** Display name: an enzyme name, a preset label, or the motif itself. */
  name: string
  /** IUPAC sequence as written. */
  sequence: string
}

export interface ConstraintOptions {
  motifs: MotifSpec[]
  /** Longest run of A or T allowed. 0 disables the check. */
  maxHomopolymerAT: number
  /** Longest run of G or C allowed. 0 disables the check. */
  maxHomopolymerGC: number
  /** Global GC bounds for the optimized region, as percentages. 0/100 disables. */
  minGC: number
  maxGC: number
  /** Sliding window for local GC, in bases. 0 disables the local check. */
  gcWindow: number
  /** Longest exact direct repeat allowed. 0 disables. */
  maxRepeat: number
  /** Longest inverted repeat (hairpin stem) allowed. 0 disables. */
  maxHairpinStem: number
  /** How far apart the two arms of a hairpin may sit and still count. */
  hairpinLoopMax: number
  avoidCpG: boolean
}

export const DEFAULT_CONSTRAINTS: ConstraintOptions = {
  motifs: [],
  maxHomopolymerAT: 0,
  maxHomopolymerGC: 0,
  minGC: 0,
  maxGC: 100,
  gcWindow: 0,
  maxRepeat: 0,
  maxHairpinStem: 0,
  hairpinLoopMax: 30,
  avoidCpG: false,
}

/**
 * Motif groups worth one click.
 *
 * These are the sequences people routinely keep out of a synthetic gene, and
 * looking each one up by hand is the kind of step that gets skipped.
 */
export const MOTIF_PRESETS: { id: string; label: string; description: string; motifs: MotifSpec[] }[] = [
  {
    id: 'type-iis',
    label: 'Type IIS sites',
    description: 'Keeps Golden Gate and similar assemblies clean',
    motifs: (ENZYME_GROUPS['Golden Gate (Type IIS)'] ?? [])
      .map(name => ({ name, sequence: getEnzyme(name)?.recognition ?? '' }))
      .filter(m => m.sequence.length > 0),
  },
  {
    id: 'shine-dalgarno',
    label: 'Internal ribosome binding sites',
    description: 'Shine-Dalgarno-like AGGAGG, for bacterial expression',
    motifs: [{ name: 'Shine-Dalgarno', sequence: 'AGGAGG' }],
  },
  {
    id: 'polya',
    label: 'PolyA signals',
    description: 'AATAAA and ATTAAA, for mammalian expression',
    motifs: [
      { name: 'PolyA AATAAA', sequence: 'AATAAA' },
      { name: 'PolyA ATTAAA', sequence: 'ATTAAA' },
    ],
  },
  {
    id: 'splice',
    label: 'Cryptic splice sites',
    description: 'Consensus donor and branch/acceptor motifs',
    motifs: [
      { name: 'Splice donor', sequence: 'GGTAAG' },
      { name: 'Splice donor (alt)', sequence: 'GGTGAT' },
      { name: 'Branch point', sequence: 'TACTAAC' },
    ],
  },
  {
    id: 'ecoli-promoter',
    label: 'E. coli promoter boxes',
    description: 'TATAAT and TTGACA, to avoid internal transcription starts',
    motifs: [
      { name: 'Pribnow box', sequence: 'TATAAT' },
      { name: '-35 box', sequence: 'TTGACA' },
    ],
  },
]

/** Motif specs for a named enzyme group from the enzyme database. */
export function motifsForEnzymeGroup(group: string): MotifSpec[] {
  const names = ENZYME_GROUPS[group]
  if (!names) return []
  return names
    .map(name => ({ name, sequence: getEnzyme(name)?.recognition ?? '' }))
    .filter(m => m.sequence.length > 0)
}

export function motifsForEnzymes(names: readonly string[]): MotifSpec[] {
  return names
    .map(name => {
      const enzyme = ENZYME_DB.find(e => e.name === name)
      return { name, sequence: enzyme?.recognition ?? '' }
    })
    .filter(m => m.sequence.length > 0)
}

/** Parse the custom motif box: one IUPAC sequence per line, `name=SEQ` allowed. */
export function parseCustomMotifs(text: string): MotifSpec[] {
  const out: MotifSpec[] = []
  for (const line of text.split(/[\n,;]/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    const name = eq > 0 ? trimmed.slice(0, eq).trim() : ''
    const raw = (eq > 0 ? trimmed.slice(eq + 1) : trimmed).trim().toUpperCase()
    if (!/^[ACGTURYSWKMBDHVN]+$/.test(raw)) continue
    // Name an unnamed motif after the sequence as stored, not as typed, so a
    // motif entered as RNA does not show up in the report spelled with U.
    const sequence = raw.replace(/U/g, 'T')
    out.push({ name: name || sequence, sequence })
  }
  return out
}

interface CompiledMotif {
  name: string
  sequence: string
  length: number
  regex: RegExp
}

export class ConstraintSet {
  readonly options: ConstraintOptions
  private readonly motifs: CompiledMotif[]
  /** How far back a change can reach: the longest pattern minus one. */
  readonly lookback: number

  constructor(options: ConstraintOptions) {
    this.options = options

    // Both strands: a site on the reverse strand cuts just as well. A
    // palindromic recognition sequence is its own reverse complement, so
    // adding the second pattern would report every site twice.
    const compiled: CompiledMotif[] = []
    const seen = new Set<string>()
    const add = (name: string, variant: string) => {
      if (seen.has(variant)) return
      seen.add(variant)
      compiled.push({
        name,
        sequence: variant,
        length: variant.length,
        regex: new RegExp(recognitionToRegex(variant), 'gi'),
      })
    }
    for (const motif of options.motifs) {
      const seq = motif.sequence.toUpperCase().replace(/U/g, 'T')
      if (!seq) continue
      add(motif.name, seq)
      const rc = reverseComplement(seq)
      if (rc !== seq) add(`${motif.name} (rev)`, rc)
    }
    this.motifs = compiled

    const spans = [
      ...compiled.map(m => m.length),
      options.maxHomopolymerAT > 0 ? options.maxHomopolymerAT + 1 : 0,
      options.maxHomopolymerGC > 0 ? options.maxHomopolymerGC + 1 : 0,
      options.gcWindow,
      options.maxRepeat > 0 ? options.maxRepeat + 1 : 0,
      options.maxHairpinStem > 0
        ? (options.maxHairpinStem + 1) * 2 + options.hairpinLoopMax
        : 0,
      options.avoidCpG ? 2 : 0,
    ]
    this.lookback = Math.max(0, ...spans) - 1
  }

  /** True when nothing is being checked, which lets the optimizer skip work. */
  get isEmpty(): boolean {
    const o = this.options
    return this.motifs.length === 0 && o.maxHomopolymerAT === 0 && o.maxHomopolymerGC === 0
      && o.minGC <= 0 && o.maxGC >= 100 && o.gcWindow === 0 && o.maxRepeat === 0
      && o.maxHairpinStem === 0 && !o.avoidCpG
  }

  /**
   * Violations touching [from, to), the incremental check.
   *
   * Only the window a change can affect is scanned, which is what keeps the
   * optimizer linear in the length of the sequence rather than quadratic.
   *
   * Two checks are left out here and done elsewhere. Global GC is a property
   * of the finished region, so it belongs to the report. Direct repeats are
   * not local at all: the optimizer tracks them with a RepeatIndex as it
   * walks, which is O(1) per codon where re-scanning would be O(n).
   */
  violationsIn(seq: string, from: number, to: number): Violation[] {
    const start = Math.max(0, from - this.lookback)
    const end = Math.min(seq.length, to + this.lookback)
    return this.scan(seq, start, end, { includeGlobalGC: false, includeRepeats: false })
      .filter(v => v.end > from && v.start < to)
  }

  /** Every violation in the sequence, for the report. */
  findViolations(seq: string): Violation[] {
    return this.scan(seq, 0, seq.length, { includeGlobalGC: true, includeRepeats: true })
  }

  private scan(
    seq: string, start: number, end: number,
    opts: { includeGlobalGC: boolean; includeRepeats: boolean },
  ): Violation[] {
    const out: Violation[] = []
    const o = this.options
    const upper = seq.toUpperCase()
    const region = upper.slice(start, end)

    for (const motif of this.motifs) {
      motif.regex.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = motif.regex.exec(region)) !== null) {
        out.push({
          kind: 'motif',
          start: start + m.index,
          end: start + m.index + motif.length,
          detail: `${motif.name} (${motif.sequence})`,
        })
        // Overlapping occurrences matter: advance by one, not by the match.
        motif.regex.lastIndex = m.index + 1
      }
    }

    if (o.maxHomopolymerAT > 0 || o.maxHomopolymerGC > 0) {
      let runStart = start
      for (let i = start; i <= end; i++) {
        const same = i < end && i > start && upper[i] === upper[i - 1]
        if (same) continue
        const base = upper[runStart]
        const runLength = i - runStart
        const limit = base === 'A' || base === 'T' ? o.maxHomopolymerAT
          : base === 'G' || base === 'C' ? o.maxHomopolymerGC
            : 0
        if (limit > 0 && runLength > limit) {
          out.push({
            kind: 'homopolymer',
            start: runStart,
            end: i,
            detail: `${runLength} x ${base}, limit ${limit}`,
          })
        }
        runStart = i
      }
    }

    if (o.gcWindow > 0 && (o.minGC > 0 || o.maxGC < 100)) {
      const w = o.gcWindow
      for (let i = start; i + w <= end; i++) {
        const gc = gcPercentOf(upper, i, i + w)
        if (gc < o.minGC || gc > o.maxGC) {
          out.push({
            kind: 'gc-window',
            start: i,
            end: i + w,
            detail: `${gc.toFixed(0)}% GC over ${w} bp`,
          })
          // One report per excursion rather than one per offset.
          i += w - 1
        }
      }
    }

    if (opts.includeRepeats && o.maxRepeat > 0) {
      const k = o.maxRepeat + 1
      const firstSeen = new Map<string, number>()
      for (let i = 0; i + k <= upper.length; i++) {
        const word = upper.slice(i, i + k)
        const prev = firstSeen.get(word)
        if (prev === undefined) { firstSeen.set(word, i); continue }
        out.push({
          kind: 'repeat',
          start: i,
          end: i + k,
          detail: `${k} bp repeat of position ${prev + 1}`,
        })
      }
    }

    if (o.maxHairpinStem > 0) {
      // A hairpin is local by definition: the two arms are at most a loop
      // apart, so the whole thing fits inside the lookback window.
      const stem = o.maxHairpinStem + 1
      const span = stem + o.hairpinLoopMax + stem
      for (let i = Math.max(0, start - span); i + stem <= upper.length; i++) {
        if (i >= end) break
        const rc = reverseComplement(upper.slice(i, i + stem))
        const searchTo = Math.min(upper.length, i + span)
        const at = upper.indexOf(rc, i + stem)
        if (at !== -1 && at + stem <= searchTo && at + stem > start) {
          out.push({
            kind: 'hairpin',
            start: i,
            end: at + stem,
            detail: `${stem} bp stem, loop ${at - (i + stem)} bp`,
          })
        }
      }
    }

    if (o.avoidCpG) {
      for (let i = start; i + 1 < end; i++) {
        if (upper[i] === 'C' && upper[i + 1] === 'G') {
          out.push({ kind: 'cpg', start: i, end: i + 2, detail: 'CpG' })
        }
      }
    }

    if (opts.includeGlobalGC && (o.minGC > 0 || o.maxGC < 100)) {
      const gc = gcPercentOf(upper, 0, upper.length)
      if (gc < o.minGC || gc > o.maxGC) {
        out.push({
          kind: 'gc-global',
          start: 0,
          end: upper.length,
          detail: `${gc.toFixed(1)}% GC overall, target ${o.minGC}-${o.maxGC}%`,
        })
      }
    }

    return out
  }
}

/**
 * Direct repeats, tracked as the optimizer walks.
 *
 * Repeats are the one constraint that is not local: the other copy can be
 * anywhere. Re-scanning the sequence at every codon would make the whole run
 * quadratic, so instead the words of the prefix are indexed as they are
 * written, and rolled back when the walk backtracks.
 */
export class RepeatIndex {
  private readonly first = new Map<string, number>()

  /** Word length that counts as a repeat: one longer than the allowed run. */
  constructor(readonly k: number) {}

  /** The word start positions that writing [from, to) creates or changes. */
  wordStarts(from: number, to: number, limit: number): number[] {
    const out: number[] = []
    for (let i = Math.max(0, from - this.k + 1); i + this.k <= Math.min(to, limit); i++) {
      out.push(i)
    }
    return out
  }

  /** Where an identical word was seen before this position, or -1. */
  earlierMatch(word: string, at: number): number {
    const prev = this.first.get(word)
    return prev !== undefined && prev !== at ? prev : -1
  }

  /** Record these words. Returns the ones newly added, for rollback. */
  add(words: readonly { word: string; at: number }[]): { word: string; at: number }[] {
    const added: { word: string; at: number }[] = []
    for (const entry of words) {
      if (!this.first.has(entry.word)) {
        this.first.set(entry.word, entry.at)
        added.push(entry)
      }
    }
    return added
  }

  /** Undo an add, when the walk gives up on a codon. */
  rollback(added: readonly { word: string; at: number }[]): void {
    for (const { word, at } of added) {
      if (this.first.get(word) === at) this.first.delete(word)
    }
  }
}

export function gcPercentOf(seq: string, start = 0, end = seq.length): number {
  let gc = 0
  let counted = 0
  for (let i = start; i < end; i++) {
    const c = seq[i]
    if (c === 'G' || c === 'C' || c === 'g' || c === 'c') gc++
    if (c !== 'N' && c !== 'n' && c !== '-') counted++
  }
  return counted === 0 ? 0 : (gc / counted) * 100
}
