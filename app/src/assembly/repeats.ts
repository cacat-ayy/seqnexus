/**
 * Short tandem repeats (microsatellites): a unit of 1–6 bases repeated
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
  const found: TandemRepeat[] = []
  for (let u = 1; u <= 6; u++) {
    let i = 0
    while (i + u * MIN_COPIES[u] <= s.length) {
      const unit = s.slice(i, i + u)
      if (/[^ACGT]/.test(unit) || isSmallerPeriod(unit)) { i++; continue }
      let j = i + u
      while (j + u <= s.length && s.slice(j, j + u) === unit) j += u
      const copies = (j - i) / u
      if (copies >= MIN_COPIES[u]) {
        // A partial copy at the end still belongs to the repeat.
        let end = j
        while (end < s.length && s[end] === unit[(end - i) % u]) end++
        found.push({ start: i, end, unit, copies })
        i = end
      } else {
        i++
      }
    }
  }
  // Longest first, then drop repeats inside one already kept.
  found.sort((a, b) => (b.end - b.start) - (a.end - a.start))
  const kept: TandemRepeat[] = []
  for (const r of found) if (!kept.some(k => r.start >= k.start && r.end <= k.end)) kept.push(r)
  return kept.sort((a, b) => a.start - b.start)
}

/** "ATAT" is (AT)2, not a unit of its own. */
function isSmallerPeriod(unit: string): boolean {
  for (let p = 1; p < unit.length; p++) {
    if (unit.length % p !== 0) continue
    if (unit.slice(0, p).repeat(unit.length / p) === unit) return true
  }
  return false
}
