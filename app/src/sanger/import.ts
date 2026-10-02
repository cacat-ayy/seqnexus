/**
 * Importing Sanger trace files (.ab1, .scf), one or a whole plate at once.
 *
 * Every file is parsed first; the reads are then added in one store update,
 * sorted by name so a plate comes in well order, quality-trimmed, and filed
 * into a folder when there is more than one. A single toast reports what came
 * in and how many reads need a look, rather than one toast per file.
 */

import { parseAb1, autoTrim } from '../io/ab1'
import { parseScf } from '../io/scf'
import type { TraceData } from '../io/trace'
import { useEditorStore } from '../store'
import { notify } from '../toast'
import { readQc } from './qc'

export const TRACE_FILE_PATTERN = /\.(ab1|abi|abif|scf)$/i

export function isTraceFile(name: string): boolean {
  return TRACE_FILE_PATTERN.test(name)
}

/** Parse one trace file; the read is named after the file. */
export async function parseTraceFile(file: File): Promise<TraceData> {
  const buffer = await file.arrayBuffer()
  const data = /\.scf$/i.test(file.name) ? parseScf(buffer) : parseAb1(buffer)
  data.name = file.name.replace(/\.[^.]+$/, '')
  return data
}

/**
 * Where a freshly imported read is trimmed: quality trimming at Q20, or
 * nothing at all when the file carries no qualities (trimming on zeros
 * would throw the whole read away).
 */
export function initialTrim(data: TraceData): [number, number] {
  if (data.metadata.qualityMissing) return [0, data.bases.length]
  const [s, e] = autoTrim(data.qualityScores)
  return e > s ? [s, e] : [0, data.bases.length]
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * A folder name for a batch: the plate when all reads share one, otherwise
 * the file names' common prefix, otherwise a dated default.
 */
export function batchFolderName(reads: TraceData[], now = new Date()): string {
  const plates = new Set(reads.map(r => r.metadata.plateName ?? ''))
  if (plates.size === 1) {
    const [plate] = plates
    if (plate) return plate
  }
  let prefix = reads[0]?.name ?? ''
  for (const r of reads) {
    let i = 0
    while (i < prefix.length && i < r.name.length && prefix[i] === r.name[i]) i++
    prefix = prefix.slice(0, i)
  }
  prefix = prefix.replace(/[\s_.-]+$/, '')
  if (prefix.length >= 3) return prefix
  return `Sanger reads ${now.toISOString().slice(0, 10)}`
}

/** Parse and add trace files. Resolves with the new read ids. */
export async function importTraceFiles(files: File[]): Promise<string[]> {
  const results = await Promise.all(files.map(async f => {
    try {
      return { file: f.name, data: await parseTraceFile(f) }
    } catch (err) {
      return { file: f.name, error: err instanceof Error ? err.message : String(err) }
    }
  }))

  const parsed = results
    .filter((r): r is { file: string; data: TraceData } => 'data' in r && r.data !== undefined)
    .map(r => r.data)
    .sort((a, b) => collator.compare(a.name, b.name))
  const failed = results.filter((r): r is { file: string; error: string } => 'error' in r)

  for (const f of failed) notify.error(`Could not read "${f.file}"`, { detail: f.error })
  if (parsed.length === 0) return []

  const folder = parsed.length > 1 ? batchFolderName(parsed) : undefined
  const ids = useEditorStore.getState().addSequencingReads(
    parsed.map(data => {
      const [trimStart, trimEnd] = initialTrim(data)
      return { data, trimStart, trimEnd }
    }),
    folder,
  )

  const verdicts = parsed.map(d => readQc(d).verdict)
  const bad = verdicts.filter(v => v === 'fail').length
  const check = verdicts.filter(v => v === 'check').length
  if (parsed.length === 1) {
    const qc = readQc(parsed[0])
    if (qc.verdict === 'fail') {
      notify.warning(`"${parsed[0].name}" looks like a failed read`, { detail: qc.issues.join('. ') })
    }
  } else {
    const parts = [`${parsed.length - bad - check} good`]
    if (check > 0) parts.push(`${check} to check`)
    if (bad > 0) parts.push(`${bad} failed`)
    const message = `Imported ${parsed.length} reads into "${folder}"`
    if (bad > 0) notify.warning(message, { detail: parts.join(' · ') })
    else notify.success(message, { detail: parts.join(' · ') })
  }
  return ids
}
