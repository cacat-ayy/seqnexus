/**
 * An assembly: one run of the assembler, kept as one item.
 *
 * A run makes any number of contigs (one per reference, or one per group of
 * overlapping reads) and leaves some reads out. Each contig used to become an
 * item of its own and the reads left out were reported once in a toast, so
 * nothing said which contigs came from the same reads or why a read was
 * missing. The assembly keeps the contigs together with the reads that went
 * in, the settings used and the reads left out, so a run can be read back
 * and repeated.
 *
 * Contigs stay records of their own in the store (each has its own undo
 * history and view). The assembly lists them by id, and each points back.
 */

import type { AssemblyReport, AssemblySettings, ContigDoc } from './types'
import type { MappingReport } from '../ngs/mapper'

/** What went into an assembly. */
export interface AssemblyInputs {
  /** The reads assembled, in the order given. */
  readIds: string[]
  /** Map to reference only: the sequence mapped to. */
  reference: { tabId: string | null; name: string } | null
}

export type UnplacedRead = AssemblyReport['unplaced'][number]

/** How an assembly was made and what it left out. */
export interface AssemblyRun {
  method: 'reference' | 'de-novo'
  /** Null for an assembly made before its settings were kept. */
  settings: AssemblySettings | null
  inputs: AssemblyInputs
  /** Reads that went in but are in no contig, each with why. */
  unplaced: UnplacedRead[]
}

/**
 * NGS reads mapped to references (Phase 3): the read set, where the
 * alignments and coverage are stored, and the report. The reads stay in the
 * read set; the alignments name them by index.
 */
export interface NgsMapping {
  readSetId: string
  readSetName: string
  /** See mappingStorageIds in ngs/jobs.ts. */
  storageId: string
  report: MappingReport
}

/** The stored part of an assembly; the store adds nothing else. */
export interface AssemblyRecord extends AssemblyRun {
  id: string
  name: string
  createdAt: number
  modifiedAt: number
  /** Its contigs, in the order shown. Empty only for an NGS mapping. */
  contigIds: string[]
  ngs?: NgsMapping
}

/** The fields of a contig that linking looks at. */
export interface LinkableContig {
  id: string
  name: string
  createdAt: number
  modifiedAt: number
  doc: ContigDoc
  assemblyId?: string
}

/** What a run must have been, read back from its contigs (for contigs saved before assemblies). */
export function runFromDocs(docs: readonly ContigDoc[]): AssemblyRun {
  const readIds: string[] = []
  const seen = new Set<string>()
  for (const d of docs) {
    for (const r of d.rows) {
      if (r.readId && !seen.has(r.readId)) { seen.add(r.readId); readIds.push(r.readId) }
    }
  }
  const ref = docs.find(d => d.reference)?.reference ?? null
  return {
    method: docs.some(d => d.method === 'reference') ? 'reference' : 'de-novo',
    settings: null,
    inputs: { readIds, reference: ref ? { tabId: ref.tabId, name: ref.name } : null },
    unplaced: [],
  }
}

/**
 * Pair assemblies with their contigs after a load or an import.
 *
 * Every contig ends up in exactly one assembly and every assembly keeps at
 * least one contig:
 * - an assembly lists only contigs that exist and do not belong to another
 *   assembly (the first to list a contig keeps it);
 * - an assembly left with no contigs is dropped;
 * - a contig no assembly lists gets an assembly of its own, named after it.
 *   That is how contigs saved before assemblies existed come back.
 *
 * `wrapped` maps each such contig's explorer uid to its new assembly's, so
 * folders, stars and notes can follow it.
 */
export function linkAssemblies<A extends AssemblyRecord, C extends LinkableContig>(
  assemblies: readonly A[],
  contigs: readonly C[],
  newId: () => string,
): { assemblies: AssemblyRecord[]; contigs: (C & { assemblyId: string })[]; wrapped: Map<string, string> } {
  const byId = new Map(contigs.map(c => [c.id, c]))
  const owner = new Map<string, string>()
  const linked: AssemblyRecord[] = []
  for (const a of assemblies) {
    const own = a.contigIds.filter(id => {
      const c = byId.get(id)
      if (!c || owner.has(id)) return false
      // A contig that names a different assembly belongs to that one.
      if (c.assemblyId && c.assemblyId !== a.id && assemblies.some(x => x.id === c.assemblyId)) return false
      return true
    })
    if (own.length === 0 && !a.ngs) continue
    for (const id of own) owner.set(id, a.id)
    linked.push({ ...a, contigIds: own })
  }
  const wrapped = new Map<string, string>()
  for (const c of contigs) {
    if (owner.has(c.id)) continue
    const id = newId()
    owner.set(c.id, id)
    wrapped.set(`contig:${c.id}`, `assembly:${id}`)
    linked.push({
      id, name: c.name, createdAt: c.createdAt, modifiedAt: c.modifiedAt,
      contigIds: [c.id], ...runFromDocs([c.doc]),
    })
  }
  return {
    assemblies: linked,
    contigs: contigs.map(c => ({ ...c, assemblyId: owner.get(c.id)! })),
    wrapped,
  }
}

const isString = (x: unknown): x is string => typeof x === 'string'

/** A stored assembly read back, or null when it is too damaged to use. */
export function sanitizeAssembly(raw: unknown): AssemblyRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const x = raw as Partial<AssemblyRecord>
  if (!isString(x.id) || !Array.isArray(x.contigIds)) return null
  const contigIds = x.contigIds.filter(isString)
  const ngs = x.ngs && typeof x.ngs === 'object' && isString(x.ngs.storageId) && isString(x.ngs.readSetId)
    && x.ngs.report && Array.isArray(x.ngs.report.references) ? x.ngs : undefined
  if (contigIds.length === 0 && !ngs) return null
  const inputs = (x.inputs ?? {}) as Partial<AssemblyInputs>
  const ref = inputs.reference
  const s = x.settings as Partial<AssemblySettings> | null | undefined
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  return {
    id: x.id,
    name: isString(x.name) && x.name ? x.name : 'Assembly',
    createdAt: num(x.createdAt) ? x.createdAt : 0,
    modifiedAt: num(x.modifiedAt) ? x.modifiedAt : num(x.createdAt) ? x.createdAt : 0,
    contigIds,
    method: x.method === 'reference' ? 'reference' : 'de-novo',
    settings: s && num(s.minIdentity) && num(s.minOverlap) && num(s.k)
      ? { minIdentity: s.minIdentity, minOverlap: s.minOverlap, k: s.k }
      : null,
    inputs: {
      readIds: Array.isArray(inputs.readIds) ? inputs.readIds.filter(isString) : [],
      reference: ref && typeof ref === 'object' && isString(ref.name)
        ? { name: ref.name, tabId: isString(ref.tabId) ? ref.tabId : null }
        : null,
    },
    unplaced: Array.isArray(x.unplaced)
      ? x.unplaced
        .filter(u => u && isString(u.name) && isString(u.reason))
        .map(u => ({ name: u.name, reason: u.reason, readId: isString(u.readId) ? u.readId : null }))
      : [],
    ...(ngs ? { ngs } : {}),
  }
}

/**
 * A name for a new assembly: after the reference it was mapped to, or after
 * what the reads' names have in common ("COI_F", "COI_R" give "COI assembly").
 */
export function assemblyName(readNames: readonly string[], referenceName: string | null, today = new Date()): string {
  if (referenceName) return `${referenceName} assembly`
  let prefix = readNames[0] ?? ''
  for (const n of readNames) {
    let i = 0
    while (i < prefix.length && i < n.length && prefix[i] === n[i]) i++
    prefix = prefix.slice(0, i)
  }
  prefix = prefix.replace(/[\s_.-]+$/, '')
  if (readNames.length > 1 && prefix.length >= 3) return `${prefix} assembly`
  return `Assembly ${today.toISOString().slice(0, 10)}`
}

/** The reference a contig was mapped to, as plain bases (without gap columns or the circular extension). */
export function referenceSource(doc: ContigDoc): string | null {
  if (!doc.reference) return null
  return doc.reference.seq.replace(/-/g, '').slice(0, doc.reference.length)
}

export interface ContigSummary {
  reads: number
  /** Columns, gaps included. */
  width: number
  /** Mean number of reads over each column some read spans. */
  meanDepth: number
  /** Share of the reference's bases some read spans; null de novo. */
  referenceCovered: number | null
}

/** The figures an assembly's overview lists for each contig. */
export function contigSummary(doc: ContigDoc): ContigSummary {
  const depth = new Uint32Array(doc.width)
  for (const r of doc.rows) {
    const end = Math.min(doc.width, r.start + r.seq.length)
    for (let c = Math.max(0, r.start); c < end; c++) depth[c]++
  }
  let spanned = 0
  let total = 0
  for (let c = 0; c < doc.width; c++) {
    if (depth[c] > 0) { spanned++; total += depth[c] }
  }
  let referenceCovered: number | null = null
  const ref = doc.reference
  if (ref && ref.length > 0) {
    // Columns past the reference's end are the circular extension, which is
    // the start of the reference again.
    const covered = new Uint8Array(ref.length)
    let pos = 0
    for (let c = 0; c < ref.seq.length && c < doc.width; c++) {
      if (ref.seq[c] === '-') continue
      if (depth[c] > 0) covered[pos % ref.length] = 1
      pos++
    }
    let n = 0
    for (let i = 0; i < ref.length; i++) n += covered[i]
    referenceCovered = n / ref.length
  }
  return {
    reads: doc.rows.length,
    width: doc.width,
    meanDepth: spanned ? total / spanned : 0,
    referenceCovered,
  }
}
