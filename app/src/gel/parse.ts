/**
 * Reading what people type into the gel: enzyme lists and band sizes.
 *
 * Enzyme names from typed or pasted text: "EcoRI+BamHI",
 * "EcoRI, BamHI", "ecori bamhi". Case-insensitive, duplicates dropped.
 */

import { ENZYME_DB, getEnzyme } from '../enzymes/db'

export function parseEnzymeList(text: string): { known: string[]; unknown: string[] } {
  const known: string[] = []
  const unknown: string[] = []
  for (const token of text.split(/[\s,+;/]+/).filter(Boolean)) {
    const e = getEnzyme(token) ?? ENZYME_DB.find(x => x.name.toLowerCase() === token.toLowerCase())
    if (e) { if (!known.includes(e.name)) known.push(e.name) }
    else unknown.push(token)
  }
  return { known, unknown }
}

/** Band sizes typed in: "1200, 800 350" → [1200, 800, 350]; "1.2 kb" → 1200. */
export function parseSizes(text: string): number[] {
  const out: number[] = []
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(kb|k|bp)?/gi)) {
    const v = parseFloat(m[1]) * (m[2] && /^k/i.test(m[2]) ? 1000 : 1)
    if (v > 0 && v <= 100_000) out.push(Math.round(v))
  }
  return out
}
