/**
 * DNA/RNA sequence backed by a PieceTable for O(log n) edits.
 *
 * All positions are 0-based, half-open intervals [start, end).
 * Topology can be 'linear' or 'circular'.
 *
 * The public API returns new Sequence instances for edits to maintain
 * compatibility with the existing immutable-style usage in tests.
 * For large sequences, the Document/Store layer uses in-place edits
 * on the PieceTable and manages undo via PieceTable snapshots.
 */

import { PieceTable } from './PieceTable'

import { COMPLEMENT } from './complement'

export type Topology = 'linear' | 'circular'

export { PieceTable } from './PieceTable'
export type { PieceTableSnapshot } from './PieceTable'

export class Sequence {
  private _pt: PieceTable
  readonly topology: Topology
  private _basesCache: string | null = null
  private _basesCacheVersion = -1

  constructor(bases: string, topology: Topology = 'linear') {
    this._pt = new PieceTable(bases)
    this.topology = topology
  }

  /** Construct a Sequence wrapping an existing PieceTable (no copy). */
  static fromPieceTable(pt: PieceTable, topology: Topology): Sequence {
    const seq = Object.create(Sequence.prototype) as Sequence
    ;(seq as any)._pt = pt
    ;(seq as any).topology = topology
    ;(seq as any)._basesCache = null
    ;(seq as any)._basesCacheVersion = -1
    return seq
  }

  /** Full bases string. Cached until the PieceTable is mutated. */
  get bases(): string {
    const v = this._pt.version
    if (this._basesCache !== null && this._basesCacheVersion === v) return this._basesCache
    const s = this._pt.toString()
    this._basesCache = s
    this._basesCacheVersion = v
    return s
  }

  get length(): number {
    return this._pt.length
  }

  get pieceTable(): PieceTable {
    return this._pt
  }

  /** Single base at position. O(log p) where p = piece count. */
  baseAt(pos: number): string {
    return this._pt.charAt(pos)
  }

  /** Substring [start, end). O(log p + k). */
  basesIn(start: number, end: number): string {
    return this._pt.substring(start, end)
  }

  // --- Immutable edit API (returns new Sequence) ---
  // Kept for backward compatibility with tests.

  insert(pos: number, fragment: string): Sequence {
    this._assertPos(pos, true)
    const newBases = this._pt.substring(0, pos) + fragment + this._pt.substring(pos, this.length)
    return new Sequence(newBases, this.topology)
  }

  delete(start: number, end: number): Sequence {
    this._assertRange(start, end)
    const newBases = this._pt.substring(0, start) + this._pt.substring(end, this.length)
    return new Sequence(newBases, this.topology)
  }

  replace(start: number, end: number, fragment: string): Sequence {
    this._assertRange(start, end)
    const newBases = this._pt.substring(0, start) + fragment + this._pt.substring(end, this.length)
    return new Sequence(newBases, this.topology)
  }

  // --- In-place edit API (mutates the PieceTable directly) ---
  // O(log p) per operation. Used by the store for efficient editing.

  insertInPlace(pos: number, fragment: string): void {
    this._assertPos(pos, true)
    this._pt.insert(pos, fragment)
  }

  deleteInPlace(start: number, end: number): void {
    this._assertRange(start, end)
    this._pt.delete(start, end - start)
  }

  replaceInPlace(start: number, end: number, fragment: string): void {
    this._assertRange(start, end)
    if (end > start) this._pt.delete(start, end - start)
    if (fragment.length > 0) this._pt.insert(start, fragment)
  }

  subseq(start: number, end: number): string {
    if (this.topology === 'circular' && end > this.length) {
      return this._pt.substring(start, this.length) + this._pt.substring(0, end % this.length)
    }
    this._assertRange(start, end)
    return this._pt.substring(start, end)
  }

  complement(): Sequence {
    const bases = this.bases
    const comp = Array.from(bases)
      .map(b => COMPLEMENT[b] ?? b)
      .join('')
    return new Sequence(comp, this.topology)
  }

  reverseComplement(): Sequence {
    const bases = this.bases
    const comp = Array.from(bases)
      .map(b => COMPLEMENT[b] ?? b)
      .reverse()
      .join('')
    return new Sequence(comp, this.topology)
  }

  gcContent(): number {
    if (this.length === 0) return 0
    const bases = this.bases.toUpperCase()
    let gc = 0
    for (let i = 0; i < bases.length; i++) {
      if (bases[i] === 'G' || bases[i] === 'C') gc++
    }
    return gc / this.length
  }

  withTopology(topology: Topology): Sequence {
    return new Sequence(this.bases, topology)
  }

  /** Complement a single base character. */
  static complementBase(base: string): string {
    return COMPLEMENT[base] ?? base
  }

  private _assertPos(pos: number, allowEnd: boolean): void {
    const max = allowEnd ? this.length : this.length - 1
    if (pos < 0 || pos > max) {
      throw new RangeError(`Position ${pos} out of bounds [0, ${max}]`)
    }
  }

  private _assertRange(start: number, end: number): void {
    if (start < 0 || end > this.length || start > end) {
      throw new RangeError(
        `Range [${start}, ${end}) out of bounds for length ${this.length}`,
      )
    }
  }
}
