/**
 * An oligo written out 5'→3' with its parts told apart: tails in lowercase
 * and muted, the annealed part in capitals, mismatches marked.
 *
 * Lowercase tails is the convention order sheets and SnapGene already use,
 * so the text still reads right when copied out of the page.
 */

import type { BindingSite } from '../../primers/binding'
import './primers.css'

export default function OligoSequence({ sequence, site }: { sequence: string; site: BindingSite | null }) {
  if (!site) return <span className="oligo-seq oligo-unbound">{sequence}</span>

  const mismatches = new Set(site.mismatches)
  const annealed: React.ReactNode[] = []
  let run = ''
  const flush = () => { if (run) { annealed.push(run); run = '' } }
  for (let i = site.annealFrom; i < site.annealTo; i++) {
    if (mismatches.has(i)) {
      flush()
      annealed.push(<mark key={i} className="oligo-mismatch">{sequence[i]}</mark>)
    } else {
      run += sequence[i]
    }
  }
  flush()

  return (
    <span className="oligo-seq">
      {site.tail5 && <span className="oligo-tail">{site.tail5.toLowerCase()}</span>}
      {annealed}
      {site.tail3 && <span className="oligo-tail">{site.tail3.toLowerCase()}</span>}
    </span>
  )
}
