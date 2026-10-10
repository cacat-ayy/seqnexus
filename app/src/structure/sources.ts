/**
 * Where structures come from, and the cache that keeps them.
 *
 * - RCSB PDB: the entry's mmCIF from files.rcsb.org (mmCIF rather than PDB
 *   format because large entries have no PDB-format file).
 * - AlphaFold DB: the prediction API names the current model file for a
 *   UniProt accession; the model is fetched in PDB format, whose B-factor
 *   column holds the per-residue pLDDT.
 * - A file the user drops or chooses, kept under the hash of its text.
 *
 * Both services send CORS headers, so the page asks them directly. Only
 * the id goes out; the sequence never does. Fetched text is stored in
 * IndexedDB, so a structure opens again without the network; a failure to
 * store is ignored (the structure is fetched again next time).
 */

import { saveStructure, loadStructure } from '../storage/idb'
import { cacheKey, isPdbId, textHash, type StructureFormat, type StructureRef } from './model'
import { detectStructureFormat } from './parse'

export const RCSB_URL = (id: string) => `https://files.rcsb.org/download/${id.toUpperCase()}.cif`
export const ALPHAFOLD_API = (accession: string) => `https://alphafold.ebi.ac.uk/api/prediction/${encodeURIComponent(accession.toUpperCase())}`
export const RCSB_ENTRY_PAGE = (id: string) => `https://www.rcsb.org/structure/${id.toUpperCase()}`
export const ALPHAFOLD_ENTRY_PAGE = (accession: string) => `https://alphafold.ebi.ac.uk/entry/${accession.toUpperCase()}`

export interface FetchedStructure {
  ref: Omit<StructureRef, 'chain'>
  text: string
}

async function cached(key: string): Promise<string | undefined> {
  try {
    return await loadStructure(key)
  } catch {
    return undefined
  }
}

async function remember(key: string, text: string): Promise<void> {
  try {
    await saveStructure(key, text)
  } catch {
    // A cache: losing it only means fetching again.
  }
}

export async function fetchPdbEntry(id: string): Promise<FetchedStructure> {
  const pdbId = id.trim().toUpperCase()
  if (!isPdbId(pdbId)) throw new Error(`"${id}" is not a PDB id (four characters, starting with a digit).`)
  const key = cacheKey('pdb', pdbId)
  const ref = { source: 'pdb' as const, id: pdbId, key, format: 'mmcif' as StructureFormat }
  const hit = await cached(key)
  if (hit) return { ref, text: hit }
  const res = await fetch(RCSB_URL(pdbId))
  if (res.status === 404) throw new Error(`PDB entry ${pdbId} was not found.`)
  if (!res.ok) throw new Error(`RCSB fetch failed: HTTP ${res.status}`)
  const text = await res.text()
  if (!/_atom_site\./.test(text)) throw new Error(`PDB entry ${pdbId} has no coordinates in mmCIF.`)
  await remember(key, text)
  return { ref, text }
}

interface AlphaFoldEntry {
  pdbUrl?: string
  cifUrl?: string
  uniprotAccession?: string
  uniprotDescription?: string
  latestVersion?: number
}

export async function fetchAlphaFoldModel(accession: string): Promise<FetchedStructure> {
  const acc = accession.trim().toUpperCase()
  if (!acc) throw new Error('Enter a UniProt accession.')
  const key = cacheKey('alphafold', acc)
  const hit = await cached(key)
  if (hit) return { ref: { source: 'alphafold', id: acc, key, format: 'pdb', title: titleFromPdb(hit) }, text: hit }
  const res = await fetch(ALPHAFOLD_API(acc))
  if (res.status === 404 || res.status === 422) throw new Error(`The AlphaFold database has no model for ${acc}.`)
  if (!res.ok) throw new Error(`AlphaFold fetch failed: HTTP ${res.status}`)
  const entries = await res.json() as AlphaFoldEntry[]
  const entry = Array.isArray(entries) ? entries.find(e => e.pdbUrl) : undefined
  if (!entry?.pdbUrl) throw new Error(`The AlphaFold database has no model for ${acc}.`)
  const model = await fetch(entry.pdbUrl)
  if (!model.ok) throw new Error(`AlphaFold model download failed: HTTP ${model.status}`)
  const text = await model.text()
  await remember(key, text)
  const title = entry.uniprotDescription
    ? `${entry.uniprotDescription} (AlphaFold model${entry.latestVersion ? ` v${entry.latestVersion}` : ''})`
    : undefined
  return { ref: { source: 'alphafold', id: acc, key, format: 'pdb', title }, text }
}

/** A file's text as a structure source, cached under the hash of its text. */
export async function structureFromFile(name: string, text: string): Promise<FetchedStructure> {
  const key = `file:${textHash(text)}`
  await remember(key, text)
  return { ref: { source: 'file', id: name, key, format: detectStructureFormat(text, name) }, text }
}

/**
 * The text behind a reference: the cache, or the network for fetched
 * sources. A file not in the cache cannot be had back; the caller asks the
 * user for it.
 */
export async function loadStructureText(ref: StructureRef): Promise<string> {
  const hit = await cached(ref.key)
  if (hit) return hit
  if (ref.source === 'pdb') return (await fetchPdbEntry(ref.id)).text
  if (ref.source === 'alphafold') return (await fetchAlphaFoldModel(ref.id)).text
  throw new StructureFileMissing(ref.id)
}

export class StructureFileMissing extends Error {
  constructor(readonly fileName: string) {
    super(`The coordinates of "${fileName}" are not in this browser. Open the file again to show it.`)
  }
}

function titleFromPdb(text: string): string | undefined {
  const lines = text.split(/\r?\n/, 40).filter(l => l.startsWith('TITLE '))
  const t = lines.map(l => l.slice(10).trim()).join(' ').replace(/\s+/g, ' ').trim()
  return t || undefined
}
