/**
 * Parse REBASE withrefm format and generate a TypeScript enzyme database.
 *
 * Usage: npx tsx scripts/build-enzyme-db.ts
 *
 * Input:  scripts/data/withrefm.txt (download from http://rebase.neb.com/rebase/link_withrefm)
 * Output: src/enzymes/db-generated.ts
 *
 * Filters to commercially available enzymes with defined cut sites.
 * The hand-curated entries in db.ts take precedence over generated ones.
 */

import { readFileSync, writeFileSync } from 'fs'
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

interface RawEnzyme {
  name: string
  isoschizomers: string[]
  recognition: string
  fwdCut: number
  revCut: number
  suppliers: string[]
}

/**
 * Parse a recognition sequence with cut markers.
 * Formats:
 *   G^AATTC        → recognition=GAATTC, fwdCut=1, revCut=5 (palindrome)
 *   GGTCTC(1/5)    → recognition=GGTCTC, fwdCut=7, revCut=11 (Type IIS)
 *   (8/13)GACNNNNNNTGG(12/7) → skip (cuts on both sides)
 */
function parseRecognition(raw: string): { recognition: string; fwdCut: number; revCut: number } | null {
  if (!raw || raw === '?' || raw.includes('(') && raw.startsWith('(')) {
    // Skip enzymes that cut on both sides or have unknown recognition
    return null
  }

  // Type IIS: RECOGNITION(fwd_offset/rev_offset)
  const typeIIS = raw.match(/^([A-Z]+)\((\d+)\/(\d+)\)$/i)
  if (typeIIS) {
    const recognition = typeIIS[1]
    const fwdOffset = parseInt(typeIIS[2], 10)
    const revOffset = parseInt(typeIIS[3], 10)
    return {
      recognition,
      fwdCut: recognition.length + fwdOffset,
      revCut: recognition.length + revOffset,
    }
  }

  // Standard: with ^ marker(s)
  if (raw.includes('^')) {
    const parts = raw.split('^')
    if (parts.length !== 2) return null // multiple cut markers — skip
    const recognition = parts[0] + parts[1]
    const fwdCut = parts[0].length

    // For palindromes, revCut = recLen - fwdCut
    // For non-palindromes, we'd need the complement strand info
    // REBASE withrefm only shows one strand, so we compute assuming palindrome
    const revCut = recognition.length - fwdCut
    return { recognition, fwdCut, revCut }
  }

  // No cut site info — enzyme with known recognition but unknown cut position
  return null
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
const outputPath = join(__dirname, '..', 'src', 'enzymes', 'db-generated.ts')

const text = readFileSync(inputPath, 'utf-8')
const lines = text.split('\n')

const enzymes: RawEnzyme[] = []
let current: Partial<Record<string, string>> = {}

for (const line of lines) {
  const match = line.match(/^<(\d+)>(.*)$/)
  if (!match) continue

  const field = match[1]
  const value = match[2].trim()

  current[field] = value

  // Field 8 is the last field per entry
  if (field === '8') {
    const name = current['1'] || ''
    const recRaw = current['3'] || ''
    const supplierCodes = current['7'] || ''

    // Skip methyltransferases (M.XxxI), homing endonucleases (I-XxxI), and nicking enzymes (Nb./Nt.)
    if (name.startsWith('M.') || name.startsWith('I-') || name.startsWith('Nb.') || name.startsWith('Nt.')) {
      current = {}
      continue
    }

    // Must have commercial suppliers
    if (!supplierCodes.trim()) {
      current = {}
      continue
    }

    const parsed = parseRecognition(recRaw)
    if (!parsed) {
      current = {}
      continue
    }

    if (!isValidIUPAC(parsed.recognition)) {
      current = {}
      continue
    }

    // Skip very long recognition sequences (>12 bp) — rare/unusual
    if (parsed.recognition.length > 12) {
      current = {}
      continue
    }

    const suppliers = [...supplierCodes].filter(c => c.trim()).map(c => SUPPLIER_MAP[c] || c).filter(Boolean)
    const isoschizomers = (current['2'] || '').split(',').map(s => s.trim()).filter(Boolean)

    enzymes.push({
      name,
      isoschizomers,
      recognition: parsed.recognition.toUpperCase(),
      fwdCut: parsed.fwdCut,
      revCut: parsed.revCut,
      suppliers,
    })

    current = {}
  }
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

// Generate TypeScript
const tsLines: string[] = [
  '/**',
  ' * Auto-generated restriction enzyme database from REBASE.',
  ' * Generated by: npx tsx scripts/build-enzyme-db.ts',
  ` * Source: REBASE withrefm format (${unique.length} enzymes)`,
  ' * Do not edit manually — re-run the script to update.',
  ' */',
  '',
  "import type { RestrictionEnzyme } from './db'",
  '',
  'export const REBASE_ENZYMES: RestrictionEnzyme[] = [',
]

for (const e of unique) {
  const overhang = computeOverhang(e.fwdCut, e.revCut)
  const suppliers = JSON.stringify(e.suppliers)
  const isoLine = e.isoschizomers.length > 0
    ? `, isoschizomers: ${JSON.stringify(e.isoschizomers.slice(0, 5))}` // cap at 5 to keep file size reasonable
    : ''
  tsLines.push(
    `  { name: '${e.name}', recognition: '${e.recognition}', fwd_cut: ${e.fwdCut}, rev_cut: ${e.revCut}, overhang: '${overhang}', suppliers: ${suppliers}${isoLine} },`
  )
}

tsLines.push(']')
tsLines.push('')

writeFileSync(outputPath, tsLines.join('\n'))
console.log(`Written to ${outputPath}`)
