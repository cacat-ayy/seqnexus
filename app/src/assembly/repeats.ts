/**
 * Short tandem repeats (microsatellites): a unit of 1 to 6 bases repeated
 * back to back. Polymerase slips in them, so a one-unit indel inside a
 * repeat is often an artefact of the read rather than of the clone.
 */

export interface TandemRepeat {
  start: number
  end: number
  unit: string
  copies: number
}

/** Fewest copies that count as a repeat, by unit length. */
const MIN_COPIES = [0, 8, 5, 4, 4, 4, 4]

export function findTandemRepeats(seq: string): TandemRepeat[] {
  const s = seq.toUpperCase()
  const n = s.length
  const acgt = (c: number) => c === 65 || c === 67 || c === 71 || c === 84
  const found: TandemRepeat[] = []
  // For each unit length u, a stretch where every base equals the one u
  // before it is periodic with period u: it is that unit repeated, a
  // partial copy at the end included. Scanning by character codes keeps a
  // genome to one pass per unit length.
  for (let u = 1; u <= 6; u++) {
    let j = u
    while (j < n) {
      if (s.charCodeAt(j) !== s.charCodeAt(j - u)) { j++; continue }
      const start = j - u
      while (j < n && s.charCodeAt(j) === s.charCodeAt(j - u)) j++
      const len = j - start
      const copies = Math.floor(len / u)
      if (copies < MIN_COPIES[u]) continue
      let ok = true
      for (let k = start; k < start + u && ok; k++) ok = acgt(s.charCodeAt(k))
      const unit = s.slice(start, start + u)
      if (ok && !isSmallerPeriod(unit)) found.push({ start, end: j, unit, copies })
    }
  }
  // Longest first, then drop repeats inside one already kept.
  found.sort((x, y) => (y.end - y.start) - (x.end - x.start) || x.start - y.start)
  const kept: TandemRepeat[] = []
  for (const r of found) if (!kept.some(k => r.start >= k.start && r.end <= k.end)) kept.push(r)
  return kept.sort((x, y) => x.start - y.start)
}

/** "ATAT" is (AT)2, not a unit of its own. */
function isSmallerPeriod(unit: string): boolean {
  for (let p = 1; p < unit.length; p++) {
    if (unit.length % p !== 0) continue
    if (unit.slice(0, p).repeat(unit.length / p) === unit) return true
  }
  return false
}
