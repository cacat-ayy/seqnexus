/**
 * How BLAST numbers, links and times are written in the drawer and in what
 * is exported from it.
 */

import { translatesHit, translatesQuery, type BlastHsp } from './types'

/** An E-value as NCBI writes it: 0, three decimals below 1, an exponent below 0.001. */
export function formatEvalue(e: number): string {
  if (e === 0) return '0'
  if (e < 0.001) return e.toExponential(1)
  if (e < 1) return e.toFixed(3)
  return e.toFixed(1)
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))
const strandName = (s: 1 | -1) => (s > 0 ? 'Plus' : 'Minus')

/** How the two sides of an HSP are read, as NCBI writes it: Strand Plus/Minus, or the frames. */
export function orientationText(program: string, hsp: BlastHsp): string | null {
  const q = translatesQuery(program), h = translatesHit(program)
  if (q && h) return `Frame ${signed(hsp.queryFrame)}/${signed(hsp.hitFrame)}`
  if (q) return `Frame ${signed(hsp.queryFrame)}`
  if (h) return `Frame ${signed(hsp.hitFrame)}`
  if (program === 'blastn' || program === 'megablast') return `Strand ${strandName(hsp.queryStrand)}/${strandName(hsp.hitStrand)}`
  return null
}

/** A relative time: "just now", "5 min ago", "yesterday", or the date. */
export function timeAgo(ts: number, now = Date.now()): string {
  const sec = Math.floor((now - ts) / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} h ago`
  const days = Math.floor(hr / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(ts).toLocaleDateString()
}

/** Whether a hit matches the drawer's filter: its accession, title or organism, ignoring case. */
export function hitMatches(hit: { accession: string; description: string; sciName: string }, filter: string): boolean {
  const q = filter.trim().toLowerCase()
  if (!q) return true
  return hit.accession.toLowerCase().includes(q) || hit.description.toLowerCase().includes(q) || hit.sciName.toLowerCase().includes(q)
}
