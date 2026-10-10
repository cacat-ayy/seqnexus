/**
 * The protein chains of a PDB or mmCIF file: residue numbers, one-letter
 * codes and per-residue B-factors, from the first model. The viewer parses
 * the coordinates itself; this is what the app needs to line the structure
 * up with a sequence and to colour it by confidence.
 *
 * A residue is counted when it has an alpha carbon and a residue name the
 * code table knows (standard, or a modified residue read as its parent),
 * so waters, ligands and nucleic acids drop out without a list of them.
 * Alternate locations are folded into one residue. Residues missing from
 * the model (disordered loops) are simply absent, which is what the
 * alignment to the sequence is for.
 */

import { THREE_TO_ONE, type ParsedStructure, type StructureChain, type StructureFormat } from './model'

interface Atom {
  chain: string
  num: number
  icode: string
  resn: string
  atom: string
  b: number
}

/** Which format the text is: mmCIF starts with a data block. */
export function detectStructureFormat(text: string, fileName = ''): StructureFormat {
  if (/\.(cif|mmcif)$/i.test(fileName)) return 'mmcif'
  if (/\.(pdb|ent)$/i.test(fileName)) return 'pdb'
  return /^\s*data_/m.test(text.slice(0, 2000)) && /_atom_site\./.test(text) ? 'mmcif' : 'pdb'
}

export function parseStructure(text: string, format: StructureFormat = detectStructureFormat(text)): ParsedStructure {
  const { atoms, title } = format === 'mmcif' ? readMmcif(text) : readPdb(text)
  return { format, title, chains: chainsOf(atoms) }
}

function chainsOf(atoms: Atom[]): StructureChain[] {
  const chains = new Map<string, { res: Map<string, { num: number; icode: string; aa: string; bSum: number; n: number; ca: boolean }> }>()
  for (const a of atoms) {
    const aa = THREE_TO_ONE[a.resn]
    if (!aa) continue
    let c = chains.get(a.chain)
    if (!c) { c = { res: new Map() }; chains.set(a.chain, c) }
    const key = `${a.num}${a.icode}`
    let r = c.res.get(key)
    if (!r) { r = { num: a.num, icode: a.icode, aa, bSum: 0, n: 0, ca: false }; c.res.set(key, r) }
    r.bSum += a.b
    r.n++
    if (a.atom === 'CA') r.ca = true
  }
  const out: StructureChain[] = []
  for (const [id, c] of chains) {
    const residues = [...c.res.values()].filter(r => r.ca).map(r => ({ num: r.num, icode: r.icode, aa: r.aa, b: r.n > 0 ? r.bSum / r.n : 0 }))
    if (residues.length === 0) continue
    out.push({ id, residues, sequence: residues.map(r => r.aa).join('') })
  }
  return out
}

function readPdb(text: string): { atoms: Atom[]; title?: string } {
  const atoms: Atom[] = []
  const titleParts: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const rec = line.slice(0, 6)
    if (rec === 'ENDMDL') break
    if (rec === 'TITLE ') titleParts.push(line.slice(10).trim())
    if (rec !== 'ATOM  ' && rec !== 'HETATM') continue
    const num = parseInt(line.slice(22, 26), 10)
    if (!Number.isFinite(num)) continue
    atoms.push({
      atom: line.slice(12, 16).trim(),
      resn: line.slice(17, 20).trim().toUpperCase(),
      chain: line.slice(21, 22).trim() || 'A',
      num,
      icode: line.slice(26, 27).trim(),
      b: parseFloat(line.slice(60, 66)) || 0,
    })
  }
  const title = titleParts.join(' ').replace(/\s+/g, ' ').trim()
  return { atoms, title: title || undefined }
}

/** Split an mmCIF data line into values: whitespace-separated, quotes respected. */
export function cifTokens(line: string): string[] {
  const out: string[] = []
  let i = 0
  const n = line.length
  while (i < n) {
    while (i < n && (line[i] === ' ' || line[i] === '\t')) i++
    if (i >= n) break
    const q = line[i]
    if (q === "'" || q === '"') {
      // A quote closes only when followed by whitespace or the line's end.
      let j = i + 1
      while (j < n && !(line[j] === q && (j + 1 >= n || line[j + 1] === ' ' || line[j + 1] === '\t'))) j++
      out.push(line.slice(i + 1, j))
      i = j + 1
    } else {
      let j = i
      while (j < n && line[j] !== ' ' && line[j] !== '\t') j++
      out.push(line.slice(i, j))
      i = j
    }
  }
  return out
}

function readMmcif(text: string): { atoms: Atom[]; title?: string } {
  const lines = text.split(/\r?\n/)
  let title: string | undefined
  const atoms: Atom[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('_struct.title')) {
      const v = cifTokens(line.slice('_struct.title'.length))
      title = v[0] ?? (lines[i + 1]?.startsWith(';') ? lines[i + 1].slice(1).trim() : undefined)
      if (title && /^[?.]$/.test(title)) title = undefined
      continue
    }
    if (line.trim() !== 'loop_' || !lines[i + 1]?.startsWith('_atom_site.')) continue
    // The atom table: column names, then rows until the next loop or category.
    const cols: string[] = []
    let j = i + 1
    while (j < lines.length && lines[j].startsWith('_atom_site.')) cols.push(lines[j++].trim().slice('_atom_site.'.length))
    const col = (name: string) => cols.indexOf(name)
    const cGroup = col('group_PDB')
    const cAtom = col('label_atom_id') >= 0 ? col('label_atom_id') : col('auth_atom_id')
    const cResn = col('auth_comp_id') >= 0 ? col('auth_comp_id') : col('label_comp_id')
    const cChain = col('auth_asym_id') >= 0 ? col('auth_asym_id') : col('label_asym_id')
    const cNum = col('auth_seq_id') >= 0 ? col('auth_seq_id') : col('label_seq_id')
    const cIcode = col('pdbx_PDB_ins_code')
    const cB = col('B_iso_or_equiv')
    const cModel = col('pdbx_PDB_model_num')
    let firstModel: string | null = null
    for (; j < lines.length; j++) {
      const row = lines[j]
      if (row.startsWith('_') || row.trim() === 'loop_' || row.startsWith('#') || row.startsWith('data_')) break
      if (!row.trim()) continue
      const t = cifTokens(row)
      if (t.length < cols.length) continue
      if (cModel >= 0) {
        if (firstModel === null) firstModel = t[cModel]
        else if (t[cModel] !== firstModel) break
      }
      if (cGroup >= 0 && t[cGroup] !== 'ATOM' && t[cGroup] !== 'HETATM') continue
      const num = parseInt(t[cNum], 10)
      if (!Number.isFinite(num)) continue
      const icode = cIcode >= 0 && t[cIcode] !== '?' && t[cIcode] !== '.' ? t[cIcode] : ''
      atoms.push({
        atom: t[cAtom].replace(/^"|"$/g, ''),
        resn: t[cResn].toUpperCase(),
        chain: t[cChain],
        num,
        icode,
        b: cB >= 0 ? parseFloat(t[cB]) || 0 : 0,
      })
    }
    break
  }
  return { atoms, title }
}
