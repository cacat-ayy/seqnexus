/**
 * Reference names as files about a mapping write them: the BAM or SAM
 * header, VCF contig lines and bedGraph rows. One rule for all, so a VCF or
 * a coverage track lines up with its BAM in IGV.
 *
 * The rule is SAM's (VCF follows it for contig IDs): no whitespace, none of
 * \ , " ' ` ( ) [ ] { } < >, and no * or = at the start. Each run of them
 * becomes "_".
 */

/** A reference name SAM, VCF and bedGraph accept. */
export function samName(name: string): string {
  return name.trim().replace(/[\s\\,"'`()[\]{}<>]+/g, '_').replace(/^[*=]+/, '_') || 'reference'
}

/** SAM names for the references, made unique. */
export function samNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return names.map(n => {
    const base = samName(n)
    const k = (seen.get(base) ?? 0) + 1
    seen.set(base, k)
    return k === 1 ? base : `${base}_${k}`
  })
}
