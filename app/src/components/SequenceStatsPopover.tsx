import './SequenceStatsPopover.css'
/**
 * Sequence statistics popover - shows composition, physical properties,
 * annotation breakdown, and codon usage.
 */

import { useMemo, useRef, useEffect, useState } from 'react'
import { X, ChevronRight, ChevronDown } from 'lucide-react'
import { useEditorStore } from '../store'
import type { Annotation } from '../models/Annotation'
import { CODON_TABLE } from '../utils/codon'

const AA_NAMES: Record<string, string> = {
  A:'Ala',C:'Cys',D:'Asp',E:'Glu',F:'Phe',G:'Gly',H:'His',I:'Ile',
  K:'Lys',L:'Leu',M:'Met',N:'Asn',P:'Pro',Q:'Gln',R:'Arg',S:'Ser',
  T:'Thr',V:'Val',W:'Trp',Y:'Tyr','*':'Stop',
}

// --- Nucleotide colors ---

const NUC_COLORS = {
  A: '#3b82f6',
  T: '#f59e0b',
  G: '#22c55e',
  C: '#ef4444',
}

// --- Computation helpers ---

interface NucCounts { A: number; T: number; G: number; C: number; other: number; total: number }

function countNucleotides(bases: string): NucCounts {
  let A = 0, T = 0, G = 0, C = 0, other = 0
  for (let i = 0; i < bases.length; i++) {
    switch (bases.charCodeAt(i)) {
      case 65: case 97: A++; break   // A/a
      case 84: case 116: T++; break  // T/t
      case 71: case 103: G++; break  // G/g
      case 67: case 99: C++; break   // C/c
      default: other++; break
    }
  }
  return { A, T, G, C, other, total: bases.length }
}

function molecularWeight(n: number, ds: boolean): number {
  // Average nucleotide MW × count + water
  return ds ? n * 607.4 + 157.9 : n * 303.7 + 79.0
}

function meltingTemperature(counts: NucCounts): number | null {
  const n = counts.total
  if (n === 0) return null
  if (n > 10000) return null
  const gc = counts.G + counts.C
  const at = counts.A + counts.T
  if (n <= 14) return 2 * at + 4 * gc // Wallace rule
  return 64.9 + 41 * (gc - 16.4) / (at + gc)
}

function extinctionCoefficient(n: number): number {
  // Simplified: ~6600 M⁻¹cm⁻¹ per base pair for dsDNA
  return n * 6600
}

function formatMW(daltons: number): string {
  if (daltons >= 1e9) return `${(daltons / 1e9).toFixed(2)} GDa`
  if (daltons >= 1e6) return `${(daltons / 1e6).toFixed(2)} MDa`
  if (daltons >= 1e3) return `${(daltons / 1e3).toFixed(2)} kDa`
  return `${daltons.toFixed(1)} Da`
}

function formatExtCoeff(val: number): string {
  if (val >= 1e7) return `${(val / 1e7).toFixed(2)} × 10⁷ M⁻¹cm⁻¹`
  if (val >= 1e6) return `${(val / 1e6).toFixed(2)} × 10⁶ M⁻¹cm⁻¹`
  return `${val.toLocaleString()} M⁻¹cm⁻¹`
}

/** Compute annotation coverage as fraction of sequence covered by at least one annotation. */
function annotationCoverage(annotations: Annotation[], seqLen: number): number {
  if (seqLen === 0 || annotations.length === 0) return 0
  // Merge intervals
  const intervals: [number, number][] = []
  for (const ann of annotations) {
    if (ann.id.startsWith('_orf_') || ann.id.startsWith('_primer_')) continue
    if (ann.start <= ann.end) {
      intervals.push([ann.start, ann.end])
    } else {
      // Origin-spanning
      intervals.push([ann.start, seqLen])
      intervals.push([0, ann.end])
    }
  }
  intervals.sort((a, b) => a[0] - b[0])
  let covered = 0
  let curEnd = 0
  for (const [s, e] of intervals) {
    const start = Math.max(s, curEnd)
    if (start < e) {
      covered += e - start
      curEnd = e
    }
  }
  return covered / seqLen
}

/** Count annotation types (excluding internal ORF/primer annotations). */
function annotationTypeCounts(annotations: Annotation[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const ann of annotations) {
    if (ann.id.startsWith('_orf_') || ann.id.startsWith('_primer_')) continue
    counts.set(ann.type, (counts.get(ann.type) || 0) + 1)
  }
  return counts
}

/** Build codon usage from CDS annotations. */
function codonUsage(annotations: Annotation[], bases: string): Map<string, { aa: string; count: number }> | null {
  const cdsAnns = annotations.filter(a => a.type === 'CDS' && !a.id.startsWith('_orf_'))
  if (cdsAnns.length === 0) return null

  const counts = new Map<string, { aa: string; count: number }>()
  for (const ann of cdsAnns) {
    let seq: string
    if (ann.start <= ann.end) {
      seq = bases.slice(ann.start, ann.end)
    } else {
      seq = bases.slice(ann.start) + bases.slice(0, ann.end)
    }
    seq = seq.toUpperCase()
    for (let i = 0; i + 2 < seq.length; i += 3) {
      const codon = seq.slice(i, i + 3)
      const aa = CODON_TABLE[codon] ?? '?'
      const entry = counts.get(codon)
      if (entry) entry.count++
      else counts.set(codon, { aa, count: 1 })
    }
  }
  return counts.size > 0 ? counts : null
}

// --- Component ---

interface Props {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
}

export default function SequenceStatsPopover({ anchorRef, onClose }: Props) {
  const doc = useEditorStore(s => s.doc)
  const popRef = useRef<HTMLDivElement>(null)

  // Close on outside click (full click: mousedown + mouseup both outside)
  useEffect(() => {
    let downOutside = false
    const isInside = (target: Node) =>
      popRef.current?.contains(target) || anchorRef.current?.contains(target)
    const handleDown = (e: MouseEvent) => {
      downOutside = !isInside(e.target as Node)
    }
    const handleUp = (e: MouseEvent) => {
      if (downOutside && !isInside(e.target as Node)) onClose()
      downOutside = false
    }
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', handleDown)
    window.addEventListener('mouseup', handleUp)
    window.addEventListener('keydown', keyHandler)
    return () => {
      window.removeEventListener('mousedown', handleDown)
      window.removeEventListener('mouseup', handleUp)
      window.removeEventListener('keydown', keyHandler)
    }
  }, [onClose, anchorRef])

  const bases = doc.sequence.bases
  const seqLen = bases.length
  const isDs = doc.metadata?.strandedness !== 'single'

  const stats = useMemo(() => {
    const counts = countNucleotides(bases)
    const gc = seqLen > 0 ? ((counts.G + counts.C) / seqLen * 100) : 0
    const at = seqLen > 0 ? ((counts.A + counts.T) / seqLen * 100) : 0
    const mw = molecularWeight(seqLen, isDs)
    const tm = meltingTemperature(counts)
    const ext = extinctionCoefficient(seqLen)
    const coverage = annotationCoverage(doc.annotations, seqLen)
    const typeCounts = annotationTypeCounts(doc.annotations)
    const totalAnns = Array.from(typeCounts.values()).reduce((a, b) => a + b, 0)
    const codons = codonUsage(doc.annotations, bases)
    return { counts, gc, at, mw, tm, ext, coverage, typeCounts, totalAnns, codons }
  }, [bases, seqLen, isDs, doc.annotations])

  // Position popover above the anchor button
  const anchorRect = anchorRef.current?.getBoundingClientRect()
  const popStyle: React.CSSProperties = {
    position: 'fixed',
    right: anchorRect ? window.innerWidth - anchorRect.right : 16,
    bottom: anchorRect ? window.innerHeight - anchorRect.top + 6 : 40,
  }

  // Build sorted codon usage grouped by amino acid
  const codonRows = useMemo(() => {
    if (!stats.codons) return null
    const entries = Array.from(stats.codons.entries()).map(([codon, { aa, count }]) => ({ codon, aa, count }))
    entries.sort((a, b) => {
      if (a.aa !== b.aa) return a.aa < b.aa ? -1 : 1
      return a.codon < b.codon ? -1 : 1
    })
    return entries
  }, [stats.codons])

  const { counts } = stats
  const [codonOpen, setCodonOpen] = useState(false)

  // Tooltip text for physical properties
  const mwTooltip = `Sum of nucleotide monophosphate weights (dAMP 331.2, dTMP 322.2, dGMP 347.2, dCMP 307.2 Da) for ${isDs ? 'both strands' : 'single strand'}. Each phosphodiester bond releases one water molecule (18.02 Da), subtracted per bond. ${doc.sequence.topology === 'circular' ? 'Circular' : 'Linear'} DNA has ${doc.sequence.topology === 'circular' ? 'N bonds per strand (no free ends)' : 'N−1 bonds per strand'}.`
  const tmTooltip = seqLen <= 14
    ? 'Tm = 2×(A+T) + 4×(G+C) (Wallace rule, for sequences ≤14 bp)'
    : seqLen <= 10000
      ? 'Tm = 64.9 + 41 × (nGC − 16.4) / N (Marmur-Doty, for sequences >30 bp)'
      : 'Tm estimation not available for sequences >10,000 bp'
  const extTooltip = 'Molar extinction coefficient at 260 nm, estimated as ~6,600 M⁻¹cm⁻¹ per base pair (dsDNA). Used to calculate concentration from absorbance via Beer-Lambert law: c = A₂₆₀ / (ε × l).'

  return (
    <div className="stats-popover" ref={popRef} style={popStyle}>
      <div className="popover-header">
        <span>Sequence Statistics</span>
        <button className="popover-close" onClick={onClose}><X size={14} /></button>
      </div>

      {/* Sequence Composition */}
      <div className="stats-section">
        <div className="stats-section-title">SEQUENCE</div>
        <div className="stats-row">
          <span>Length</span>
          <span>{seqLen.toLocaleString()} bp</span>
        </div>
        <div className="stats-row">
          <span>GC content</span>
          <span>{stats.gc.toFixed(1)}%</span>
        </div>
        <div className="stats-row">
          <span>AT content</span>
          <span>{stats.at.toFixed(1)}%</span>
        </div>

        {/* Horizontal nucleotide color bar */}
        {seqLen > 0 && (
          <div className="stats-nuc-bar">
            <div className="stats-nuc-bar-seg" style={{ width: `${counts.A / seqLen * 100}%`, background: NUC_COLORS.A }} />
            <div className="stats-nuc-bar-seg" style={{ width: `${counts.T / seqLen * 100}%`, background: NUC_COLORS.T }} />
            <div className="stats-nuc-bar-seg" style={{ width: `${counts.G / seqLen * 100}%`, background: NUC_COLORS.G }} />
            <div className="stats-nuc-bar-seg" style={{ width: `${counts.C / seqLen * 100}%`, background: NUC_COLORS.C }} />
          </div>
        )}

        {(['A', 'T', 'G', 'C'] as const).map(nuc => (
          <div className="stats-row" key={nuc}>
            <span className="stats-nuc-label">
              <span className="stats-nuc-dot" style={{ background: NUC_COLORS[nuc] }} />
              {nuc}
            </span>
            <span>{counts[nuc].toLocaleString()} ({seqLen > 0 ? (counts[nuc] / seqLen * 100).toFixed(1) : '0.0'}%)</span>
          </div>
        ))}
      </div>

      {/* Physical Properties */}
      <div className="stats-section">
        <div className="stats-section-title">PROPERTIES</div>
        <div className="stats-row stats-row-tip" data-tooltip={mwTooltip}>
          <span>Est. MW ({isDs ? 'dsDNA' : 'ssDNA'})</span>
          <span>{formatMW(stats.mw)}</span>
          <div className="stats-tip">{mwTooltip}</div>
        </div>
        <div className="stats-row stats-row-tip" data-tooltip={tmTooltip}>
          <span>Est. Tm</span>
          <span>{stats.tm !== null ? `${stats.tm.toFixed(1)} °C` : 'N/A (>10 kbp)'}</span>
          <div className="stats-tip">{tmTooltip}</div>
        </div>
        <div className="stats-row stats-row-tip" data-tooltip={extTooltip}>
          <span>ε₂₆₀</span>
          <span>{formatExtCoeff(stats.ext)}</span>
          <div className="stats-tip">{extTooltip}</div>
        </div>
      </div>

      {/* Annotations */}
      <div className="stats-section">
        <div className="stats-section-title">ANNOTATIONS</div>
        <div className="stats-row">
          <span>Features</span>
          <span>{stats.totalAnns}</span>
        </div>
        {Array.from(stats.typeCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => (
            <div className="stats-row stats-row-indent" key={type}>
              <span>{type}</span>
              <span>{count}</span>
            </div>
          ))}
        <div className="stats-row">
          <span>Sequence annotated</span>
          <span>{(stats.coverage * 100).toFixed(1)}%</span>
        </div>
      </div>

      {/* Codon Usage - collapsible */}
      {codonRows && (
        <div className="stats-section">
          <button className="stats-collapse-btn" onClick={() => setCodonOpen(v => !v)}>
            {codonOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="stats-section-title" style={{ marginBottom: 0 }}>CODON USAGE</span>
            <span className="stats-collapse-count">{codonRows.length} codons</span>
          </button>
          {codonOpen && (
            <div className="stats-codon-table">
              <div className="stats-codon-header">
                <span>Codon</span>
                <span>AA</span>
                <span>Count</span>
              </div>
              {codonRows.map(({ codon, aa, count }) => (
                <div className="stats-codon-row" key={codon}>
                  <span className="stats-codon-seq">{codon}</span>
                  <span>{aa} ({AA_NAMES[aa] || '?'})</span>
                  <span>{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
