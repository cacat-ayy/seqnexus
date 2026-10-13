/**
 * A read set's k-mer spectrum: the genome length and k-mer coverage it
 * gives, the share of k-mers that are sequencing errors, and the spectrum
 * itself. Shown on the read set's page (counted on request) and on the
 * Contigs page of a short-read assembly.
 */

import { Hash } from 'lucide-react'
import { spectrumBins, type KmerSpectrum } from '../../ngs/denovo/spectrum'
import { formatBp } from '../../utils/format'
import { HistogramChart } from './charts'

const nf = new Intl.NumberFormat('en-US')

interface Props {
  spectrum: KmerSpectrum | undefined
  /** Count the k-mers (absent where they cannot be counted). */
  onCount?: () => void
  /** Progress of a count running, 0 to 1. */
  counting?: number | null
}

export default function KmerSpectrumCard({ spectrum: s, onCount, counting = null }: Props) {
  return (
    <section className="ngs-card">
      <div className="ngs-card-title">k-mers and genome size</div>
      {!s ? (
        <>
          <p className="aw-note">
            Counting the reads&apos; 21-mers gives the length of the genome they come from and the depth it was sequenced to, before
            anything is assembled. Large read sets are sampled by k-mer, so this takes seconds to a minute.
          </p>
          {onCount && (
            <div className="ngs-actions ngs-card-actions">
              <button className="aw-btn" onClick={onCount} disabled={counting !== null}>
                <Hash size={13} /> {counting !== null ? `Counting ${Math.round(counting * 100)}%` : 'Count k-mers'}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="ngs-tiles">
            <div className="ngs-tile">
              <div className="ngs-tile-label">Genome length</div>
              <div className="ngs-tile-value">{s.genomeSize !== null ? formatBp(s.genomeSize) : 'Unclear'}</div>
              <div className="ngs-tile-detail">{s.genomeSize !== null ? 'estimated from the k-mers' : 'no peak past the errors: too little coverage, or not one genome'}</div>
            </div>
            {s.peak !== null && (
              <div className="ngs-tile">
                <div className="ngs-tile-label">k-mer coverage</div>
                <div className="ngs-tile-value">{nf.format(s.peak)}×</div>
                <div className="ngs-tile-detail">each {s.k}-mer of the genome seen about this often</div>
              </div>
            )}
            {s.errorShare !== null && (
              <div className="ngs-tile">
                <div className="ngs-tile-label">Error k-mers</div>
                <div className="ngs-tile-value">{(s.errorShare * 100).toFixed(1)}%</div>
                <div className="ngs-tile-detail">of k-mer occurrences, below the valley at {s.trough}×</div>
              </div>
            )}
          </div>
          <HistogramChart title={`${s.k}-mer spectrum`}
            subtitle={`k-mers by how often they occur, weighted by that count${s.fraction < 1 ? `; ${(s.fraction * 100).toFixed(s.fraction < 0.1 ? 1 : 0)}% of k-mers sampled` : ''}`}
            hist={spectrumBins(s)} unit="k-mer occurrences"
            binLabel={(lo, hi) => (hi - lo <= 1 ? `seen ${nf.format(lo)}×` : `seen ${nf.format(lo)} to ${nf.format(hi - 1)}×`)}
            tickLabel={v => `${nf.format(v)}×`} />
        </>
      )}
    </section>
  )
}
