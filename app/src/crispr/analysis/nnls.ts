/**
 * Non-negative least squares, by the active-set method of Lawson and Hanson.
 *
 * The decomposition of an edited trace asks: which mixture of shifted copies
 * of the control explains what was read? A mixture cannot have negative
 * parts, and an ordinary least-squares fit happily returns them, so the
 * constraint is not a refinement here but the thing that makes the answer
 * mean anything.
 *
 * The problems this solves are small, a few hundred rows by a few dozen
 * columns, so the plainest implementation is the right one: solve the
 * unconstrained problem on the columns currently allowed, drop any that came
 * back negative, repeat.
 */

/** Solve A x = b for x >= 0, minimising the squared residual. */
export function nnls(
  A: readonly Float64Array[],
  b: Float64Array,
  maxIterations = 100,
  tolerance = 1e-10,
): Float64Array {
  const rows = b.length
  const cols = A.length
  const x = new Float64Array(cols)
  const passive: boolean[] = new Array(cols).fill(false)

  // Gradient of the residual with respect to each column.
  const gradient = () => {
    const residual = new Float64Array(rows)
    for (let r = 0; r < rows; r++) {
      let fitted = 0
      for (let c = 0; c < cols; c++) if (x[c] !== 0) fitted += A[c][r] * x[c]
      residual[r] = b[r] - fitted
    }
    const w = new Float64Array(cols)
    for (let c = 0; c < cols; c++) {
      let dot = 0
      for (let r = 0; r < rows; r++) dot += A[c][r] * residual[r]
      w[c] = dot
    }
    return w
  }

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const w = gradient()
    // The column that would most reduce the residual, among those not yet in.
    let best = -1
    let bestValue = tolerance
    for (let c = 0; c < cols; c++) {
      if (!passive[c] && w[c] > bestValue) { best = c; bestValue = w[c] }
    }
    if (best === -1) break
    passive[best] = true

    for (let inner = 0; inner < maxIterations; inner++) {
      const indices = passive.map((p, i) => (p ? i : -1)).filter(i => i >= 0)
      const solution = leastSquares(A, b, indices)
      // Any column that came back negative cannot stay.
      let worst = -1
      let worstRatio = Infinity
      for (let k = 0; k < indices.length; k++) {
        if (solution[k] <= tolerance) {
          const i = indices[k]
          const ratio = x[i] / (x[i] - solution[k])
          if (ratio < worstRatio) { worstRatio = ratio; worst = i }
        }
      }
      if (worst === -1) {
        const next = new Float64Array(cols)
        indices.forEach((i, k) => { next[i] = solution[k] })
        x.set(next)
        break
      }
      // Step as far towards the unconstrained answer as non-negativity allows.
      const alpha = worstRatio
      indices.forEach((i, k) => {
        x[i] = x[i] + alpha * (solution[k] - x[i])
        if (x[i] <= tolerance) { x[i] = 0; passive[i] = false }
      })
      if (!passive[worst]) continue
      passive[worst] = false
      x[worst] = 0
    }
  }

  for (let c = 0; c < cols; c++) if (x[c] < 0) x[c] = 0
  return x
}

/**
 * Ordinary least squares over a subset of columns, by normal equations with
 * Gaussian elimination. The subsets here are small and well conditioned
 * enough that nothing fancier earns its place.
 */
function leastSquares(A: readonly Float64Array[], b: Float64Array, indices: readonly number[]): Float64Array {
  const n = indices.length
  const out = new Float64Array(n)
  if (n === 0) return out
  const rows = b.length

  // Normal equations: (AtA) x = Atb.
  const ata: Float64Array[] = []
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(n + 1)
    for (let j = 0; j < n; j++) {
      let dot = 0
      const ci = A[indices[i]]
      const cj = A[indices[j]]
      for (let r = 0; r < rows; r++) dot += ci[r] * cj[r]
      row[j] = dot
    }
    let rhs = 0
    const ci = A[indices[i]]
    for (let r = 0; r < rows; r++) rhs += ci[r] * b[r]
    row[n] = rhs
    // A tiny ridge keeps a singular subset from exploding; it is far below
    // the signal and changes nothing that was already well determined.
    row[i] += 1e-9
    ata.push(row)
  }

  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(ata[r][col]) > Math.abs(ata[pivot][col])) pivot = r
    }
    if (Math.abs(ata[pivot][col]) < 1e-12) continue
    if (pivot !== col) { const t = ata[pivot]; ata[pivot] = ata[col]; ata[col] = t }
    const p = ata[col][col]
    for (let r = col + 1; r < n; r++) {
      const factor = ata[r][col] / p
      if (factor === 0) continue
      for (let c = col; c <= n; c++) ata[r][c] -= factor * ata[col][c]
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let sum = ata[r][n]
    for (let c = r + 1; c < n; c++) sum -= ata[r][c] * out[c]
    out[r] = Math.abs(ata[r][r]) < 1e-12 ? 0 : sum / ata[r][r]
  }
  return out
}

/** How much of the variation the fit accounts for, 0 to 1. */
export function rSquared(observed: Float64Array, fitted: Float64Array): number {
  let mean = 0
  for (const v of observed) mean += v
  mean /= observed.length || 1
  let ssRes = 0
  let ssTot = 0
  for (let i = 0; i < observed.length; i++) {
    ssRes += (observed[i] - fitted[i]) ** 2
    ssTot += (observed[i] - mean) ** 2
  }
  if (ssTot === 0) return ssRes === 0 ? 1 : 0
  return Math.max(0, 1 - ssRes / ssTot)
}
