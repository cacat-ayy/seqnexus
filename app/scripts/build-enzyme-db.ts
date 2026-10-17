/**
 * Parse REBASE withrefm format and generate a TypeScript enzyme database.
 *
 * Usage: npx tsx scripts/build-enzyme-db.ts
 *
 * Input:  scripts/data/withrefm.txt (download from http://rebase.neb.com/rebase/link_withrefm)
 * Output: src/enzymes/db-generated.ts
 * Also reads scripts/data/rebase-methylation.json (from
 * fetch-rebase-methylation.ts) for each enzyme's Dam and Dcm sensitivity.
 *
 * Keeps the commercially available restriction enzymes with a defined cut.
 * Every commercial enzyme it leaves out is printed with the reason, so a
 * new REBASE release cannot lose enzymes without anyone noticing.
 * The hand-curated entries in db.ts take precedence over generated ones.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const SUPPLIER_MAP: Record<string, string> = {
  B: 'Thermo',
  C: 'Minotech',
  E: 'Agilent',
  I: 'SibEnzyme',
  J: 'Nippon Gene',
  K: 'Takara',
  M: 'Roche',
  N: 'NEB',
  O: 'Toyobo',
  Q: 'CHIMERx',
  R: 'Promega',
  S: 'Sigma',
  V: 'Vivantis',
  X: 'EURx',
}

/** Longest recognition sequence kept (XcmI is 15 bp; homing enzymes run to 30 and more). */
const MAX_RECOGNITION = 20

/**
 * Bottom-strand cuts that withrefm cannot give. A caret marks the cut on the
 * one strand written; the build takes the other from symmetry, which only
 * holds for a palindromic site. These are the commercial enzymes whose
 * caret-form site is not a palindrome, with both cuts from REBASE's
 * two-strand (EMBOSS) data, which NEB's enzyme pages agree with.
 *
 * TspRI and its isoschizomer TscAI read CASTG and cut NNCASTGNN^ on the top
 * strand and ^NNCASTGNN on the bottom: 7 after the site's start and 2 before
 * it, a 9-base 3' overhang. withrefm writes this as CASTGNN^, and the
 * symmetry rule on CASTGNN put the bottom cut at 0.
 */
const ASYMMETRIC_CARET: Record<string, { recognition: string; fwdCut: number; revCut: number }> = {
  TspRI: { recognition: 'CASTG', fwdCut: 7, revCut: -2 },
  TscAI: { recognition: 'CASTG', fwdCut: 7, revCut: -2 },
}

interface Parsed {
  recognition: string
  fwdCut: number
  revCut: number
  /** Type IIB: the second cut pair, upstream of the site. */
  fwdCut2?: number
  revCut2?: number
}

interface RawEnzyme extends Parsed {
  name: string
  isoschizomers: string[]
  suppliers: string[]
}

const COMPLEMENT: Record<string, string> = {
  A: 'T', C: 'G', G: 'C', T: 'A', R: 'Y', Y: 'R', S: 'S', W: 'W',
  K: 'M', M: 'K', B: 'V', V: 'B', D: 'H', H: 'D', N: 'N',
}
const reverseComplement = (s: string) => [...s.toUpperCase()].reverse().map(c => COMPLEMENT[c] ?? c).join('')

/**
 * Parse a recognition sequence with its cut, in REBASE's notation. Cut
 * positions come back relative to the first base of the site, between base
 * `cut - 1` and base `cut`, the bottom strand's in top-strand coordinates.
 *
 *   G^AATTC                  -> GAATTC, top 1, bottom 5 (palindrome: bottom = length - top)
 *   GGTCTC(1/5)              -> GGTCTC, top 7, bottom 11 (cuts past the site's 3' end)
 *   GAATGC(1/-1)             -> GAATGC, top 7, bottom 5 (a negative offset cuts inside the site)
 *   (10/15)ACNNNNGTAYC(12/7) -> top 23, bottom 18, and upstream top -10, bottom -15 (Type IIB)
 *
 * Returns a reason string for a site it cannot place.
 */
function parseRecognition(name: string, raw: string): Parsed | string {
  if (!raw || raw === '?') return 'recognition unknown'

  const typeIIB = raw.match(/^\((-?\d+)\/(-?\d+)\)([A-Z]+)\((-?\d+)\/(-?\d+)\)$/i)
  if (typeIIB) {
    const recognition = typeIIB[3]
    const n = recognition.length
    // "(a/b)" before the site counts back from its first base: the top strand
    // is cut a bases upstream, the bottom strand b bases upstream.
    return {
      recognition,
      fwdCut: n + parseInt(typeIIB[4], 10),
      revCut: n + parseInt(typeIIB[5], 10),
      fwdCut2: -parseInt(typeIIB[1], 10),
      revCut2: -parseInt(typeIIB[2], 10),
    }
  }
  if (raw.startsWith('(')) return `cut notation not understood: ${raw}`

  const offset = raw.match(/^([A-Z]+)\((-?\d+)\/(-?\d+)\)$/i)
  if (offset) {
    const recognition = offset[1]
    return {
      recognition,
      fwdCut: recognition.length + parseInt(offset[2], 10),
      revCut: recognition.length + parseInt(offset[3], 10),
    }
  }

  if (raw.includes('^')) {
    const parts = raw.split('^')
    if (parts.length !== 2) return 'several cut markers'
    const recognition = parts[0] + parts[1]
    if (reverseComplement(recognition) !== recognition.toUpperCase()) {
      const known = ASYMMETRIC_CARET[name]
      return known ?? `bottom-strand cut unknown: ${raw} is not a palindrome`
    }
    const fwdCut = parts[0].length
    return { recognition, fwdCut, revCut: recognition.length - fwdCut }
  }

  return 'cut position unknown'
}

function computeOverhang(fwdCut: number, revCut: number): 'blunt' | '5prime' | '3prime' {
  if (fwdCut === revCut) return 'blunt'
  if (fwdCut < revCut) return '5prime'
  return '3prime'
}

function isValidIUPAC(seq: string): boolean {
  return /^[ACGTRYSWKMBDHVN]+$/i.test(seq)
}

// --- Main ---

const inputPath = join(__dirname, 'data', 'withrefm.txt')
const methylationPath = join(__dirname, 'data', 'rebase-methylation.json')
type Verdict = 'blocked' | 'impaired' | 'insensitive'
const methylation: Record<string, { dam?: Verdict | 'required'; dcm?: Verdict | 'required' }> = existsSync(methylationPath)
  ? JSON.parse(readFileSync(methylationPath, 'utf-8')).enzymes
  : {}

/**
 * Enzymes that cut only modified DNA, which REBASE's methylation summaries
 * do not say. MspJI cuts next to 5-methylcytosine (mCNNR) and leaves
 * unmethylated DNA alone; in E. coli DNA the methylated cytosines are Dcm's,
 * so it needs Dcm methylation to cut. (The app checks that a Dcm-methylated
 * base lies in the site, not that it is the first base, so on Dcm-methylated
 * DNA it may name a few sites MspJI would not cut.)
 */
const REQUIRES_METHYLATION: Record<string, { dam?: 'required'; dcm?: 'required' }> = {
  MspJI: { dcm: 'required' },
}
const outputPath = join(__dirname, '..', 'src', 'enzymes', 'db-generated.ts')

const text = readFileSync(inputPath, 'utf-8')
// Split on CRLF too: a Windows checkout of the data file has it.
const lines = text.split(/\r?\n/)

const enzymes: RawEnzyme[] = []
const dropped: { name: string; recognition: string; reason: string }[] = []
let current: Partial<Record<string, string>> = {}

for (const line of lines) {
  const match = line.match(/^<(\d+)>(.*)$/)
  if (!match) continue

  const field = match[1]
  const value = match[2].trim()

  current[field] = value

  // Field 8 is the last field per entry
  if (field !== '8') continue
  const entry = current
  current = {}

  const name = entry['1'] || ''
  const recRaw = entry['3'] || ''
  const supplierCodes = entry['7'] || ''

  // Methyltransferases (M.), homing endonucleases (I-, and inteins PI-) and
  // nicking enzymes (Nb., Nt.) are not restriction enzymes in this sense.
  if (/^(M\.|I-|PI-|Nb\.|Nt\.)/.test(name)) continue
  // Only enzymes someone sells.
  if (!supplierCodes.trim()) continue

  const parsed = parseRecognition(name, recRaw)
  if (typeof parsed === 'string') { dropped.push({ name, recognition: recRaw, reason: parsed }); continue }
  if (!isValidIUPAC(parsed.recognition)) { dropped.push({ name, recognition: recRaw, reason: 'not IUPAC' }); continue }
  if (parsed.recognition.length > MAX_RECOGNITION) {
    dropped.push({ name, recognition: recRaw, reason: `recognition longer than ${MAX_RECOGNITION} bp` })
    continue
  }

  const suppliers = [...supplierCodes].filter(c => c.trim()).map(c => SUPPLIER_MAP[c] || c).filter(Boolean)
  const isoschizomers = (entry['2'] || '').split(',').map(s => s.trim()).filter(Boolean)

  enzymes.push({ name, isoschizomers, suppliers, ...parsed, recognition: parsed.recognition.toUpperCase() })
}

// Deduplicate by name (keep first occurrence)
const seen = new Set<string>()
const unique = enzymes.filter(e => {
  if (seen.has(e.name)) return false
  seen.add(e.name)
  return true
})

// Sort alphabetically
unique.sort((a, b) => a.name.localeCompare(b.name))

console.log(`Parsed ${unique.length} commercially available enzymes from REBASE`)
if (dropped.length > 0) {
  console.log(`Left out ${dropped.length} commercial enzymes:`)
  for (const d of dropped) console.log(`  ${d.name.padEnd(12)} ${d.recognition.padEnd(24)} ${d.reason}`)
}

// Generate TypeScript
const tsLines: string[] = [
  '/**',
  ' * Auto-generated restriction enzyme database from REBASE.',
  ' * Generated by: npx tsx scripts/build-enzyme-db.ts',
  ` * Source: REBASE withrefm format (${unique.length} enzymes)`,
  ' * Do not edit manually: re-run the script to update.',
  ' */',
  '',
  "import type { RestrictionEnzyme } from './db'",
  '',
  'export const REBASE_ENZYMES: RestrictionEnzyme[] = [',
]

for (const e of unique) {
  const overhang = computeOverhang(e.fwdCut, e.revCut)
  const suppliers = JSON.stringify(e.suppliers)
  const second = e.fwdCut2 !== undefined ? `, fwd_cut2: ${e.fwdCut2}, rev_cut2: ${e.revCut2}` : ''
  const meth = { ...methylation[e.name], ...REQUIRES_METHYLATION[e.name] }
  const methLine = (meth?.dam ? `, dam: '${meth.dam}'` : '') + (meth?.dcm ? `, dcm: '${meth.dcm}'` : '')
  const isoLine = e.isoschizomers.length > 0
    ? `, isoschizomers: ${JSON.stringify(e.isoschizomers.slice(0, 5))}` // cap at 5 to keep file size reasonable
    : ''
  tsLines.push(
    `  { name: '${e.name}', recognition: '${e.recognition}', fwd_cut: ${e.fwdCut}, rev_cut: ${e.revCut}${second}, overhang: '${overhang}', suppliers: ${suppliers}${methLine}${isoLine} },`
  )
}

tsLines.push(']')
tsLines.push('')

writeFileSync(outputPath, tsLines.join('\n'))
console.log(`Written to ${outputPath}`)
