/**
 * FASTQ reader.
 *
 * A record is four logical parts: an `@name` header, the sequence, a `+`
 * separator, and per-base quality characters. Sequence and quality may each be
 * hard-wrapped across several lines, so quality is accumulated until it
 * matches the sequence length rather than assuming one line each.
 *
 * The app exports FASTQ from sequencing reads; this is the matching import
 * side. Note that FASTQ carries no trace data, so records load as plain
 * sequences rather than chromatograms — the quality scores are kept here so
 * callers can report them, but there is nothing to draw a trace from.
 */

export interface FastqRecord {
  name: string
  bases: string
  /** Phred scores, one per base, decoded from the ASCII quality line. */
  qualityScores: number[]
}

/**
 * Quality is decoded as Phred+33 (Sanger, Illumina 1.8+), which is the
 * universal encoding today.
 *
 * Phred+64 (Illumina 1.3–1.7) is deliberately not auto-detected: the two
 * ranges overlap, so any heuristic misreads either old +64 files or modern
 * high-quality +33 files, and a wrong score is worse than an unsupported one.
 * A +64 file decodes to implausibly high scores (~Q60+) rather than silently
 * plausible wrong ones.
 */
const PHRED_OFFSET = 33

/**
 * Parse FASTQ text into records.
 *
 * @throws if a record is structurally invalid (missing separator, or quality
 *         length not matching sequence length) — a silent partial parse would
 *         be worse than a clear failure for sequencing data.
 */
export function parseFastq(text: string): FastqRecord[] {
  const lines = text.split(/\r?\n/)
  const raw: { name: string; bases: string; quality: string }[] = []

  let i = 0
  // Tolerate leading blank lines.
  while (i < lines.length && lines[i].trim() === '') i++

  while (i < lines.length) {
    const header = lines[i]
    if (header.trim() === '') { i++; continue }
    if (!header.startsWith('@')) {
      throw new Error(`Line ${i + 1}: expected a record header starting with "@"`)
    }
    // Only the first whitespace-delimited token is the identifier; the rest is
    // free-text description.
    const name = header.slice(1).trim().split(/\s+/)[0] || `read_${raw.length + 1}`
    i++

    let bases = ''
    while (i < lines.length && !lines[i].startsWith('+')) {
      bases += lines[i].trim()
      i++
    }
    if (i >= lines.length) {
      throw new Error(`Record "${name}": missing "+" separator line`)
    }
    i++ // skip the '+' line

    // Quality may wrap; read until it covers the sequence. A '@' here is
    // ambiguous with a header, which is exactly why length is the terminator.
    let quality = ''
    while (i < lines.length && quality.length < bases.length) {
      quality += lines[i].trim()
      i++
    }
    if (quality.length !== bases.length) {
      throw new Error(
        `Record "${name}": quality length (${quality.length}) does not match sequence length (${bases.length})`,
      )
    }

    raw.push({ name, bases: bases.toUpperCase(), quality })

    while (i < lines.length && lines[i].trim() === '') i++
  }

  return raw.map(r => ({
    name: r.name,
    bases: r.bases,
    qualityScores: Array.from(r.quality, c => Math.max(0, c.charCodeAt(0) - PHRED_OFFSET)),
  }))
}

/** Mean Phred score, rounded to one decimal. Returns 0 for an empty read. */
export function meanQuality(scores: number[]): number {
  if (scores.length === 0) return 0
  const sum = scores.reduce((a, b) => a + b, 0)
  return Math.round((sum / scores.length) * 10) / 10
}
