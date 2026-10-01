/**
 * Adding sequences to an alignment without disturbing it: each new sequence
 * is aligned to the alignment as a profile (column residue frequencies), and
 * only gap columns are inserted into the existing rows.
 *
 * Profile–sequence scoring is the expected substitution score under the
 * column's residue frequencies; gaps are affine (Gotoh) with free end gaps,
 * so a partial sequence (a read, a fragment, a single domain) lies where it
 * fits instead of being stretched across the whole alignment.
 */

import { scoreProtein } from '../alignment/matrices'
import { GAP, cleanResidues, newRowId, squareUp, ungapped, type AlnDoc, type AlnKind, type AlnRow, type RowInput } from './model'

const DNA_ALPHABET = 'ACGT'
const AA_ALPHABET = 'ARNDCQEGHILKMFPSTWYV'

interface Scoring {
  alphabet: string
  index: Int8Array
  /** S[a * K + b] */
  matrix: Float32Array
  open: number
  extend: number
}

function scoring(kind: AlnKind): Scoring {
  const alphabet = kind === 'dna' ? DNA_ALPHABET : AA_ALPHABET
  const K = alphabet.length
  const index = new Int8Array(128).fill(-1)
  for (let i = 0; i < K; i++) index[alphabet.charCodeAt(i)] = i
  if (kind === 'dna') index['U'.charCodeAt(0)] = 3
  const matrix = new Float32Array(K * K)
  for (let a = 0; a < K; a++) {
    for (let b = 0; b < K; b++) {
      // EDNAFULL-like for DNA, BLOSUM62 for protein.
      matrix[a * K + b] = kind === 'dna' ? (a === b ? 5 : -4) : scoreProtein(alphabet[a], alphabet[b])
    }
  }
  return kind === 'dna'
    ? { alphabet, index, matrix, open: 10, extend: 0.5 }
    : { alphabet, index, matrix, open: 11, extend: 1 }
}

/** For each profile column, the expected score against each residue type: v[i * K + b]. */
function columnVectors(rows: readonly string[], sc: Scoring): Float32Array {
  const K = sc.alphabet.length
  const w = rows[0]?.length ?? 0
  const n = rows.length || 1
  const v = new Float32Array(w * K)
  const freq = new Float32Array(K)
  for (let i = 0; i < w; i++) {
    freq.fill(0)
    for (const r of rows) {
      const c = r.charCodeAt(i)
      const a = c < 128 ? sc.index[c] : -1
      if (a >= 0) freq[a] += 1 / n
    }
    for (let a = 0; a < K; a++) {
      if (freq[a] === 0) continue
      for (let b = 0; b < K; b++) v[i * K + b] += freq[a] * sc.matrix[a * K + b]
    }
  }
  return v
}

const NEG = -1e30

/**
 * Align one ungapped sequence to a profile of gapped rows. Returns, for each
 * output column, which profile column (or -1) and which residue (or -1) it
 * holds.
 */
export function alignSequenceToProfile(rows: readonly string[], seq: string, kind: AlnKind): { prof: Int32Array; res: Int32Array } {
  const sc = scoring(kind)
  const K = sc.alphabet.length
  const W = rows[0]?.length ?? 0
  const V = seq.length
  const v = columnVectors(rows, sc)
  const sym = new Int8Array(V)
  for (let j = 0; j < V; j++) {
    const c = seq.charCodeAt(j)
    sym[j] = c < 128 ? sc.index[c] : -1
  }
  const { open, extend } = sc
  // Rolling score rows; full traceback (2 bits per state per cell).
  let M = new Float64Array(V + 1)
  let X = new Float64Array(V + 1) // profile column against a gap
  let Y = new Float64Array(V + 1) // residue against a gap column
  let pM = new Float64Array(V + 1)
  let pX = new Float64Array(V + 1)
  let pY = new Float64Array(V + 1)
  const trace = new Uint8Array((W + 1) * (V + 1))

  // Row 0: residues before the first profile column cost nothing (free end gaps).
  pM.fill(NEG); pX.fill(NEG); pY.fill(NEG)
  pM[0] = 0
  for (let j = 1; j <= V; j++) pY[j] = 0
  for (let i = 1; i <= W; i++) {
    M.fill(NEG); X.fill(NEG); Y.fill(NEG)
    // Column 0: profile columns before the sequence starts are free.
    X[0] = 0
    const endRow = i === W
    for (let j = 1; j <= V; j++) {
      const cell = i * (V + 1) + j
      let t = 0
      // Match: profile column i-1 with residue j-1.
      const s = sym[j - 1] >= 0 ? v[(i - 1) * K + sym[j - 1]] : -1
      let best = pM[j - 1], from = 0
      if (pX[j - 1] > best) { best = pX[j - 1]; from = 1 }
      if (pY[j - 1] > best) { best = pY[j - 1]; from = 2 }
      M[j] = best + s
      t |= from
      // X: profile column i-1 against a gap; free after the sequence ends.
      const endCol = j === V
      const o = endCol ? 0 : open
      const e = endCol ? 0 : extend
      best = pM[j] - o; from = 0
      if (pX[j] - e > best) { best = pX[j] - e; from = 1 }
      if (pY[j] - o > best) { best = pY[j] - o; from = 2 }
      X[j] = best
      t |= from << 2
      // Y: residue j-1 against a gap column; free after the last profile column.
      const oy = endRow ? 0 : open
      const ey = endRow ? 0 : extend
      best = M[j - 1] - oy; from = 0
      if (Y[j - 1] - ey > best) { best = Y[j - 1] - ey; from = 2 }
      if (X[j - 1] - oy > best) { best = X[j - 1] - oy; from = 1 }
      Y[j] = best
      t |= from << 4
      trace[cell] = t
    }
    ;[M, pM] = [pM, M]
    ;[X, pX] = [pX, X]
    ;[Y, pY] = [pY, Y]
  }

  // Traceback from the best end state.
  let state = 0
  let best = pM[V]
  if (pX[V] > best) { best = pX[V]; state = 1 }
  if (pY[V] > best) { state = 2 }
  if (W === 0) state = 2
  if (V === 0) state = 1
  const prof: number[] = []
  const res: number[] = []
  let i = W
  let j = V
  while (i > 0 || j > 0) {
    if (i === 0) state = 2
    else if (j === 0) state = 1
    const t = trace[i * (V + 1) + j]
    if (state === 0) {
      prof.push(i - 1); res.push(j - 1)
      state = t & 3
      i--; j--
    } else if (state === 1) {
      prof.push(i - 1); res.push(-1)
      state = (t >> 2) & 3
      i--
    } else {
      prof.push(-1); res.push(j - 1)
      state = (t >> 4) & 3
      j--
    }
  }
  prof.reverse()
  res.reverse()
  return { prof: Int32Array.from(prof), res: Int32Array.from(res) }
}

/** Cells a profile addition would fill, for refusing jobs that would freeze the page. */
export function profileCost(doc: AlnDoc, seqs: readonly string[]): number {
  const w = doc.rows[0]?.seq.length ?? 0
  let cells = 0
  for (const s of seqs) cells += (w + s.length) * s.length
  return cells
}

/**
 * Add sequences to an alignment, keeping its rows as they are apart from
 * new gap columns. Longer sequences go first, so later ones align against a
 * richer profile; the new rows are appended in the order given.
 */
export function addToAlignment(doc: AlnDoc, inputs: readonly RowInput[]): { doc: AlnDoc; ids: string[] } {
  const added: AlnRow[] = inputs.map(r => {
    const row: AlnRow = { id: newRowId(), name: r.name.trim() || 'Unnamed', seq: ungapped(cleanResidues(r.seq, doc.kind)) }
    if (r.source) row.source = r.source
    if (r.start !== undefined && r.start !== 1) row.start = r.start
    return row
  })
  let rows: AlnRow[] = [...doc.rows]
  const order = added.map((_, i) => i).sort((a, b) => added[b].seq.length - added[a].seq.length)
  const placed = new Map<number, AlnRow>()
  for (const k of order) {
    const r = added[k]
    if (!r.seq) { placed.set(k, r); continue }
    const profileRows = [...rows.map(x => x.seq), ...[...placed.values()].map(x => x.seq)]
    const { prof, res } = alignSequenceToProfile(profileRows, r.seq, doc.kind)
    // Widen every existing row (and earlier additions) to the new columns.
    const widen = (seq: string) => {
      let out = ''
      for (let c = 0; c < prof.length; c++) out += prof[c] >= 0 ? seq[prof[c]] : GAP
      return out
    }
    rows = rows.map(x => ({ ...x, seq: widen(x.seq) }))
    for (const [key, p] of placed) placed.set(key, { ...p, seq: widen(p.seq) })
    let seq = ''
    for (let c = 0; c < res.length; c++) seq += res[c] >= 0 ? r.seq[res[c]] : GAP
    placed.set(k, { ...r, seq })
  }
  const newRows = added.map((_, i) => placed.get(i)!)
  // Rows the edit only padded keep their identity where nothing changed.
  const original = new Map(doc.rows.map(r => [r.id, r]))
  const merged = rows.map(r => (original.get(r.id)?.seq === r.seq ? original.get(r.id)! : r))
  return { doc: { ...doc, rows: squareUp([...merged, ...newRows]) }, ids: newRows.map(r => r.id) }
}
