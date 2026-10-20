/**
 * Recognising the result folder of a whole-plasmid sequencing service in a
 * drop, by what its files are rather than by whose they are.
 *
 * A service returns several files per sample, all named after the sample
 * and often spread over one folder per kind of file (Plasmidsaurus writes
 * `<order>_fasta-files/<id>_<sample>.fasta`, `<order>_genbank-files/<id>_<sample>.gbk`,
 * `<order>_ab1-files/<id>_<sample>.ab1`, and the reads as `<id>_<sample>.fastq.gz`
 * in a zip of their own). So the files are grouped by their name without
 * its extensions (the stem), wherever they lie in the drop, and each file
 * gets a role:
 *
 * - consensus: FASTA (.fasta, .fa, .fas, .fna), the sequence the service
 *   assembled, starting at an origin of its own choosing;
 * - genbank: the same consensus annotated (.gbk, .gb); used for its bases
 *   only when there is no FASTA, its features never;
 * - reads: the raw reads (.fastq.gz, .fq.gz, .fastq, .fq);
 * - trace: a chromatogram made from the reads (.ab1), whose second peaks
 *   mark positions where the reads disagree;
 * - extra: pictures, interactive maps, tables and summaries (.png, .html,
 *   .tsv, .txt, .csv, .pdf, .svg), which are passed over.
 *
 * A stem is a sample when it has a consensus (FASTA or GenBank) and more
 * evidence beside it: reads, or both forms of the consensus. A FASTA beside
 * a chromatogram alone is not enough, since that is how Sanger results come
 * (`A01.ab1` with its calls as `A01.fasta`); a sample's chromatogram joins it
 * by name. A construct file of the user's own (`pX12.gb`, dropped with the
 * results) has a stem of its own and is opened as an ordinary file. A
 * consensus with no more than that counts as a sample only in a drop that
 * holds samples, and only when it lies in the same folder as another
 * sample's consensus (the vendor's folder of FASTA files), or, dropped
 * loose, is named with their order's prefix. Nothing here looks at contents: the
 * offer to verify is a question, and declining it imports the files as
 * any other drop.
 */

export type FileRole = 'consensus' | 'genbank' | 'reads' | 'trace' | 'extra'

const ROLE_PATTERNS: [FileRole, RegExp][] = [
  ['reads', /\.(fastq|fq)(\.gz)?$/i],
  ['consensus', /\.(fasta|fa|fas|fna)$/i],
  ['genbank', /\.(gbk|gb|gbff|genbank)$/i],
  ['trace', /\.(ab1|abi)$/i],
  ['extra', /\.(png|jpe?g|svg|html?|tsv|txt|csv|pdf|log)$/i],
]

/** What a file is to a result set, by its name; null for anything else. */
export function fileRole(name: string): FileRole | null {
  for (const [role, re] of ROLE_PATTERNS) if (re.test(name)) return role
  return null
}

/** A file's name without its folder and its extensions ("a/JPY6QT_1_pGFP.fastq.gz" gives "JPY6QT_1_pGFP"). */
export function sampleStem(name: string): string {
  const base = name.split('/').pop() ?? name
  return base.replace(/\.gz$/i, '').replace(/\.[^.]+$/, '')
}

export interface ResultSample {
  /** The stem the files share. */
  name: string
  consensus: File | null
  genbank: File | null
  reads: File | null
  trace: File | null
  /** Files of the sample that are not used (maps, plots, tables). */
  extras: File[]
}

export interface ResultSets {
  samples: ResultSample[]
  /** Files that belong to no sample: opened as ordinary files. */
  rest: File[]
}

const dirOf = (path: string) => path.split('/').slice(0, -1).join('/')

/**
 * The samples of the result sets in a drop. `pathOf` gives a file's path
 * inside what was dropped (its name when it was dropped on its own).
 */
export function findResultSets(files: readonly File[], pathOf: (f: File) => string = f => f.name): ResultSets {
  const byStem = new Map<string, { name: string; files: File[] }>()
  for (const f of files) {
    if (!fileRole(f.name)) continue
    const stem = sampleStem(f.name)
    const key = stem.toLowerCase()
    const g = byStem.get(key)
    if (g) g.files.push(f)
    else byStem.set(key, { name: stem, files: [f] })
  }
  const toSample = (g: { name: string; files: File[] }): ResultSample => {
    const first = (role: FileRole) => g.files.find(f => fileRole(f.name) === role) ?? null
    return {
      name: g.name,
      consensus: first('consensus'),
      genbank: first('genbank'),
      reads: first('reads'),
      trace: first('trace'),
      extras: g.files.filter(f => fileRole(f.name) === 'extra'),
    }
  }
  const all = [...byStem.values()].map(toSample)
  const hasConsensus = (s: ResultSample) => !!(s.consensus || s.genbank)
  const full = (s: ResultSample) => hasConsensus(s) && !!(s.reads || (s.consensus && s.genbank))
  const samples = all.filter(full)
  if (samples.length === 0) return { samples: [], rest: [...files] }
  // A lone consensus in the folder that holds other samples' consensus
  // files; dropped loose, one named like them (the order's prefix).
  const consensusDirs = new Set(samples.flatMap(s => [s.consensus, s.genbank].filter((f): f is File => !!f).map(f => dirOf(pathOf(f)))))
  const prefix = (n: string) => n.split(/[_\-. ]/)[0].toLowerCase()
  const shared = samples.every(s => prefix(s.name) === prefix(samples[0].name)) && prefix(samples[0].name).length >= 3 && samples[0].name.length > prefix(samples[0].name).length
    ? prefix(samples[0].name) : null
  for (const s of all) {
    if (samples.includes(s) || !hasConsensus(s)) continue
    const dir = dirOf(pathOf((s.consensus ?? s.genbank)!))
    if (dir ? consensusDirs.has(dir) : shared !== null && prefix(s.name) === shared) samples.push(s)
  }
  samples.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
  const used = new Set(samples.flatMap(s => [s.consensus, s.genbank, s.reads, s.trace, ...s.extras].filter((f): f is File => !!f)))
  return { samples, rest: files.filter(f => !used.has(f)) }
}

/** The files a sample is verified from, for saying what it was checked against. */
export function sampleFiles(s: ResultSample): File[] {
  return [s.consensus, s.genbank, s.reads, s.trace].filter((f): f is File => !!f)
}
