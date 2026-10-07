/**
 * Contigs polished outside SeqNexus, read back from a FASTA file.
 *
 * medaka, Polypolish and Pilon all write each contig under the name it went
 * in with, so contigs are matched by name (as exported, "Contig_1", or as
 * shown, "Contig 1"); a file whose names match none of them but has as many
 * records is taken in order. Anything else is refused with what was found,
 * rather than guessed at.
 */

export interface FastaRecord {
  name: string
  seq: string
}

export function parseFasta(text: string): FastaRecord[] {
  const out: FastaRecord[] = []
  let cur: FastaRecord | null = null
  const parts: string[] = []
  const flush = () => { if (cur) { cur.seq = parts.join('').replace(/[^A-Za-z]/g, '').toUpperCase(); out.push(cur) } parts.length = 0 }
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('>')) {
      flush()
      cur = { name: line.slice(1).trim().split(/\s+/)[0] ?? '', seq: '' }
    } else if (cur) parts.push(line.trim())
  }
  flush()
  return out.filter(r => r.seq.length > 0)
}

export interface PolishedContig {
  name: string
  bases: string
  circular: boolean
  /** The bases differ from the contig's before. */
  changed: boolean
}

export function matchPolished(
  records: readonly FastaRecord[],
  contigs: readonly { name: string; fastaName: string; circular: boolean; bases: string }[],
): PolishedContig[] {
  if (records.length === 0) throw new Error('The file has no sequences in FASTA format.')
  const byName = new Map(records.map(r => [r.name, r]))
  const found = contigs.map(c => byName.get(c.fastaName) ?? byName.get(c.name))
  let picked: FastaRecord[]
  if (found.every(Boolean)) picked = found as FastaRecord[]
  else if (found.some(Boolean)) {
    const missing = contigs.filter((_, i) => !found[i]).map(c => c.fastaName)
    throw new Error(`The file has no sequence for ${missing.join(', ')}. Polish every contig, or export them again and polish that file.`)
  } else if (records.length === contigs.length) picked = [...records]
  else {
    throw new Error(`The file's ${records.length} sequences (${records.slice(0, 3).map(r => r.name).join(', ')}${records.length > 3 ? ', ...' : ''}) do not match the ${contigs.length} contigs by name (${contigs.map(c => c.fastaName).join(', ')}) or by number.`)
  }
  return contigs.map((c, i) => {
    const bases = picked[i].seq.replace(/[^ACGTN]/g, 'N')
    if (bases.length < 50) throw new Error(`${c.name} came back only ${bases.length} bases long.`)
    return { name: c.name, bases, circular: c.circular, changed: bases !== c.bases.toUpperCase() }
  })
}
