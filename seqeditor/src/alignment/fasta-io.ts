/**
 * FASTA serialization and deserialization for WASM tool I/O.
 */

/** Serialize sequences to FASTA format. */
export function toFasta(sequences: { name: string; bases: string }[]): string {
  return sequences
    .map(s => `>${s.name}\n${wrapLines(s.bases, 80)}`)
    .join('\n')
}

/** Parse aligned FASTA output (with gap characters). */
export function fromAlignedFasta(fasta: string): { name: string; alignedBases: string }[] {
  const results: { name: string; alignedBases: string }[] = []
  let currentName = ''
  let currentBases: string[] = []

  for (const line of fasta.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('>')) {
      if (currentName) {
        results.push({ name: currentName, alignedBases: currentBases.join('') })
      }
      currentName = trimmed.slice(1).trim()
      currentBases = []
    } else {
      currentBases.push(trimmed)
    }
  }
  if (currentName) {
    results.push({ name: currentName, alignedBases: currentBases.join('') })
  }

  return results
}

/** Wrap a string into lines of a given width. */
function wrapLines(s: string, width: number): string {
  const lines: string[] = []
  for (let i = 0; i < s.length; i += width) {
    lines.push(s.slice(i, i + width))
  }
  return lines.join('\n')
}
