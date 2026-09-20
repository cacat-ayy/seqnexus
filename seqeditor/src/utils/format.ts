/** Format a base-pair count with appropriate unit (bp, kb, Mbp). */
export function formatBp(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} Mbp`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} kb`
  return `${n} bp`
}
