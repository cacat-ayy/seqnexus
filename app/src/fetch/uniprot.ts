/**
 * UniProtKB REST client: an entry by accession or entry name, as a protein
 * document with its annotated features.
 *
 * The REST service (rest.uniprot.org) answers JSON with CORS headers, so a
 * page can ask it directly; the entry's features come in one request. The
 * cross-references to PDB and AlphaFold are kept in the document's
 * metadata for the structure viewer.
 */

import type { AnnotationData } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { Sequence } from '../models/Sequence'
import { Annotation, defaultColorForType } from '../models/Annotation'

const ENTRY_URL = 'https://rest.uniprot.org/uniprotkb/'

/** A UniProt accession (P69905, A0A024R161, with an optional isoform suffix) or entry name (HBA_HUMAN). */
export function looksLikeUniProt(text: string): boolean {
  const s = text.trim()
  return /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})(-\d+)?$/i.test(s)
    || /^[A-Z0-9]{1,10}_[A-Z]{1,5}[A-Z0-9]{0,2}$/i.test(s) && !/^[A-Z]{2}_\d/i.test(s)
}

/** What the structure phase needs: where this entry's structures are. */
export interface UniProtReference {
  accession: string
  entryName?: string
  organism?: string
  /** Reviewed (Swiss-Prot) rather than automatic (TrEMBL). */
  reviewed?: boolean
  pdbIds?: string[]
  alphaFold?: boolean
}

interface UniProtLocation { value?: number; modifier?: string }
interface UniProtFeature {
  type: string
  description?: string
  featureId?: string
  location: { start: UniProtLocation; end: UniProtLocation }
  alternativeSequence?: { originalSequence?: string; alternativeSequences?: string[] }
}
interface UniProtEntry {
  primaryAccession: string
  uniProtkbId?: string
  entryType?: string
  organism?: { scientificName?: string; commonName?: string }
  proteinDescription?: { recommendedName?: { fullName?: { value?: string } }; submissionNames?: { fullName?: { value?: string } }[] }
  genes?: { geneName?: { value?: string } }[]
  sequence?: { value?: string }
  features?: UniProtFeature[]
  uniProtKBCrossReferences?: { database: string; id: string }[]
  comments?: { commentType: string; texts?: { value: string }[] }[]
}

/** UniProt feature types to the protein feature keys the app uses. Absent: not imported. */
const FEATURE_TYPE: Readonly<Record<string, string>> = {
  'Signal': 'sig_peptide',
  'Transit peptide': 'transit_peptide',
  'Chain': 'Chain',
  'Peptide': 'mat_peptide',
  'Propeptide': 'propeptide',
  'Domain': 'Domain',
  'Zinc finger': 'Domain',
  'DNA binding': 'Domain',
  'Region': 'Region',
  'Coiled coil': 'Region',
  'Compositional bias': 'Region',
  'Topological domain': 'Region',
  'Intramembrane': 'Region',
  'Motif': 'Motif',
  'Repeat': 'Repeat',
  'Transmembrane': 'transmembrane',
  'Active site': 'active_site',
  'Binding site': 'binding_site',
  'Site': 'Site',
  'Modified residue': 'modified_residue',
  'Lipidation': 'modified_residue',
  'Cross-link': 'modified_residue',
  'Non-standard residue': 'modified_residue',
  'Glycosylation': 'glycosylation',
  'Disulfide bond': 'disulfide',
  'Natural variant': 'variant',
  'Mutagenesis': 'variant',
}

/** The entry's features as annotations on its sequence. */
export function uniprotFeatures(entry: UniProtEntry, seqLen: number): AnnotationData[] {
  const out: AnnotationData[] = []
  let n = 0
  for (const f of entry.features ?? []) {
    const type = FEATURE_TYPE[f.type]
    if (!type) continue
    const s = f.location.start.value
    const e = f.location.end.value
    if (s === undefined || e === undefined || s < 1 || e > seqLen || e < s) continue
    const start = s - 1
    const end = e
    const id = `uni_${entry.primaryAccession}_${++n}`
    const qualifiers: Record<string, string[]> = { uniprot_type: [f.type] }
    if (f.featureId) qualifiers.feature_id = [f.featureId]
    let name = f.description?.trim() || f.type
    if (type === 'disulfide') {
      // An interchain bond is written with one residue; it is still a Cys to count.
      if (end - start > 1) {
        out.push({ id, name: name === f.type ? 'Disulfide' : name, type, start, end, strand: 0, qualifiers, segments: [[start, start + 1], [end - 1, end]] })
      } else {
        qualifiers.note = ['Interchain']
        out.push({ id, name: name === f.type ? 'Disulfide (interchain)' : name, type, start, end, strand: 0, qualifiers })
      }
      continue
    }
    if (type === 'variant') {
      const orig = f.alternativeSequence?.originalSequence
      const alts = f.alternativeSequence?.alternativeSequences ?? []
      if (orig) qualifiers.original = [orig]
      if (alts.length > 0) qualifiers.replacement = [alts.join(',')]
      if (f.description) qualifiers.note = [f.description]
      const alt = alts.length === 1 ? alts[0] : alts.length === 0 ? 'del' : alts.join('/')
      name = orig && orig.length === 1 && end - start === 1 ? `p.${orig}${s}${alt}` : orig ? `${orig}>${alt}` : name
      if (f.type === 'Mutagenesis') qualifiers.experiment = ['mutagenesis']
    } else if (f.description) {
      qualifiers.note = [f.description]
    }
    out.push({ id, name, type, start, end, strand: 0, color: defaultColorForType(type), qualifiers })
  }
  return out
}

/** The entry as a document. Throws when it has no sequence. */
export function uniprotDocument(entry: UniProtEntry): DocumentState {
  const residues = entry.sequence?.value?.trim().toUpperCase() ?? ''
  if (!residues) throw new Error(`UniProt entry ${entry.primaryAccession} has no sequence.`)
  const gene = entry.genes?.[0]?.geneName?.value
  const full = entry.proteinDescription?.recommendedName?.fullName?.value
    ?? entry.proteinDescription?.submissionNames?.[0]?.fullName?.value
  const organism = entry.organism?.scientificName
  const name = gene ?? entry.uniProtkbId ?? entry.primaryAccession
  const description = [full, organism ? `(${organism})` : ''].filter(Boolean).join(' ')
  const xrefs = entry.uniProtKBCrossReferences ?? []
  const pdbIds = xrefs.filter(x => x.database === 'PDB').map(x => x.id)
  const uniprot: UniProtReference = {
    accession: entry.primaryAccession,
    entryName: entry.uniProtkbId,
    organism,
    reviewed: entry.entryType?.includes('Swiss-Prot') || undefined,
    pdbIds: pdbIds.length > 0 ? pdbIds : undefined,
    alphaFold: xrefs.some(x => x.database === 'AlphaFoldDB') || undefined,
  }
  const annotations = uniprotFeatures(entry, residues.length)
  const seq = new Sequence(residues, 'linear', 'protein')
  return {
    name,
    description: description || undefined,
    sequence: seq,
    annotations: annotations.map(a => new Annotation(a)),
    metadata: { origin: 'uniprot', uniprot },
  }
}

/** Fetch one entry's JSON. */
export async function fetchUniProtEntry(query: string): Promise<UniProtEntry> {
  const id = query.trim()
  const res = await fetch(`${ENTRY_URL}${encodeURIComponent(id)}.json`, { headers: { Accept: 'application/json' } })
  if (res.status === 404 || res.status === 400) throw new Error(`"${id}" was not found in UniProtKB.`)
  if (!res.ok) throw new Error(`UniProt fetch failed: HTTP ${res.status}`)
  const data = await res.json() as UniProtEntry & { messages?: string[] }
  if (!data.primaryAccession) throw new Error(data.messages?.join(' ') || `"${id}" was not found in UniProtKB.`)
  return data
}

export async function fetchUniProt(query: string): Promise<DocumentState> {
  return uniprotDocument(await fetchUniProtEntry(query))
}
