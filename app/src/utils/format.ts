/** Number formatting shared across the app. */

import type { Alphabet } from '../models/alphabet'

/** A base count: 812 bp, 1.5 kb, 1.50 Mb, 3.20 Gb. */
export function formatBp(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} Gb`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} Mb`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} kb`
  return `${n} bp`
}

/** A residue count: 245 aa, 1,245 aa. A protein is never long enough to abbreviate. */
export function formatAa(n: number): string {
  return `${n.toLocaleString('en-US')} aa`
}

/** A length in the unit of its alphabet. */
export function formatLength(n: number, alphabet: Alphabet): string {
  return alphabet === 'protein' ? formatAa(n) : formatBp(n)
}

/** A byte count: 512 B, 24 KB, 3.5 MB, 1.2 GB. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}
