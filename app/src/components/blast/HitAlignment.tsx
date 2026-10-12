/**
 * A BLAST hit's alignments: one block per HSP, in lines of 60 columns
 * numbered at both ends the way NCBI numbers them (see alignmentLines).
 */

import { useMemo } from 'react'
import { useEditorStore } from '../../store'
import { alignmentLines } from '../../blast/query'
import { alignsAsProtein, type BlastHit, type BlastHsp } from '../../blast/types'
import { formatEvalue, orientationText } from '../../blast/format'
import { buildBasePalette } from '../../utils/base-colors'
import { buildResiduePalette } from '../../utils/residue-colors'

export default function HitAlignment({ hit, program, id }: { hit: BlastHit; program: string; id: string }) {
  return (
    <div className="bd-alignment" id={id}>
      {hit.hsps.map((h, i) => {
        const orientation = orientationText(program, h)
        return (
          <div key={i} className="bd-hsp">
            <div className="bd-hsp-head">
              {hit.hsps.length > 1 && <span className="bd-hsp-num">HSP {i + 1}</span>}
              <span>Score {Math.round(h.bitScore)} bits</span>
              <span>E {formatEvalue(h.evalue)}</span>
              <span>Identity {(h.identity * 100).toFixed(1)}%</span>
              {h.gaps > 0 && <span>Gaps {h.gaps}</span>}
              {orientation && <span>{orientation}</span>}
            </div>
            <AlignmentBlock hsp={h} program={program} />
          </div>
        )
      })}
    </div>
  )
}

/**
 * The letter colours of the sequence view: the user's nucleotide or protein
 * scheme from the shared palettes (a scientific convention, so its colours
 * are data rather than theme). `currentColor` stands for the theme's text
 * colour, which the "None" scheme, gaps and unknown letters take.
 */
function useLetterPalette(isProtein: boolean): Record<string, string> {
  const scheme = useEditorStore(s => s.colorScheme)
  const proteinScheme = useEditorStore(s => s.proteinColorScheme)
  return useMemo(
    () => (isProtein ? buildResiduePalette(proteinScheme, 'currentColor') : buildBasePalette(scheme, 'currentColor')),
    [isProtein, scheme, proteinScheme],
  )
}

const isGap = (c: string) => c === '-' || c === '.'

/** A line of one side, each run of letters in its colour; a mismatch also gets a tint behind it. */
function ColoredSeq({ seq, midline, other, palette }: { seq: string; midline: string; other: string; palette: Record<string, string> }) {
  const parts: { color: string; cls: string; text: string }[] = []
  for (let i = 0; i < seq.length; i++) {
    const ch = seq[i]
    const gap = isGap(ch)
    const mis = !gap && !isGap(other[i]) && midline[i] === ' '
    const letter = palette[ch]
    const color = gap || !letter || letter === 'currentColor' ? '' : letter
    const cls = gap ? 'bd-gap' : mis ? 'bd-mis' : ''
    const last = parts[parts.length - 1]
    if (last && last.color === color && last.cls === cls) last.text += ch
    else parts.push({ color, cls, text: ch })
  }
  return <>{parts.map((p, i) =>
    <span key={i} className={p.cls || undefined} style={p.color ? { color: p.color } : undefined}>{p.text}</span>,
  )}</>
}

function ColoredMid({ midline, qseq, hseq }: { midline: string; qseq: string; hseq: string }) {
  const parts: { cls: string; text: string }[] = []
  for (let i = 0; i < midline.length; i++) {
    const gap = isGap(qseq[i]) || isGap(hseq[i])
    const cls = gap ? 'bd-gap' : midline[i] === ' ' ? 'bd-mid-mis' : 'bd-mid'
    const last = parts[parts.length - 1]
    if (last && last.cls === cls) last.text += midline[i]
    else parts.push({ cls, text: midline[i] })
  }
  return <>{parts.map((p, i) => <span key={i} className={p.cls}>{p.text}</span>)}</>
}

function AlignmentBlock({ hsp, program }: { hsp: BlastHsp; program: string }) {
  const palette = useLetterPalette(alignsAsProtein(program))
  const lines = alignmentLines(hsp, program)
  const width = Math.max(...lines.flatMap(l => [l.qStart, l.hStart]).map(n => String(n).length))
  const label = (name: string, at: number) => `${name.padEnd(7)}${String(at).padStart(width)}  `

  return (
    <pre className="bd-align-pre">
      {lines.map((l, i) => (
        <span key={i}>
          <span className="bd-align-label">{label('Query', l.qStart)}</span>
          <ColoredSeq seq={l.qseq} midline={l.mid} other={l.hseq} palette={palette} />
          <span className="bd-align-label">{`  ${l.qEnd}`}</span>{'\n'}
          <span className="bd-align-label">{''.padEnd(7 + width + 2)}</span>
          <ColoredMid midline={l.mid} qseq={l.qseq} hseq={l.hseq} />{'\n'}
          <span className="bd-align-label">{label('Sbjct', l.hStart)}</span>
          <ColoredSeq seq={l.hseq} midline={l.mid} other={l.qseq} palette={palette} />
          <span className="bd-align-label">{`  ${l.hEnd}`}</span>{'\n'}
          {i < lines.length - 1 && '\n'}
        </span>
      ))}
    </pre>
  )
}
