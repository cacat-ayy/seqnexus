/**
 * The Contigs page of a de novo assembly: the contigs made from the reads,
 * with their length, whether they closed into a circle, their coverage and
 * (long reads) their share of the sample and how much each polishing round
 * changed. Below, how they were found: the read lengths with their peaks
 * (long reads of whole products), the layout (long reads of a genome), or
 * the k-mer spectrum and the k-values tried (short reads), and how the
 * assembly was made.
 *
 * The contigs are kept with the mapping (the reads were mapped back to
 * them), so Open as sequence and the FASTA export read them from there.
 * Polishing outside (medaka for nanopore reads, which SeqNexus cannot ship:
 * its licence allows research use only and rules out the GNU licences) comes
 * back through Import polished contigs: the reads are mapped to the polished
 * contigs, which replace these, with an Undo.
 */

import './ReadSetWorkspace.css'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Copy, Download, FilePlus2, GitCompareArrows, Rows3, Upload } from 'lucide-react'
import { useEditorStore, type Assembly } from '../../store'
import { notify } from '../../toast'
import { readReferenceBases } from '../../ngs/sam'
import { getReadChunk } from '../../storage/idb'
import { remapContigs } from './remapContigs'
import { DENOVO_METHOD_LABEL, type DeNovoReport } from '../../ngs/denovo/types'
import { PEAK_TOLERANCE } from '../../ngs/denovo/clusters'
import { matchPolished, parseFasta } from '../../ngs/denovo/polished'
import { formatBp } from '../../utils/format'
import { NEEDS_WEB, openedAsFile } from '../../ngs/jobs'
import { HistogramChart } from './charts'
import KmerSpectrumCard from './KmerSpectrumCard'
import CoverageGcChart from './CoverageGcChart'

const CompareDialog = lazy(() => import('./CompareDialog'))

const nf = new Intl.NumberFormat()
const pct = (x: number) => `${(x * 100).toFixed(1)}%`

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const fastaName = (name: string) => name.replace(/\s+/g, '_')

export default function DeNovoPage({ assembly, onShowReads }: { assembly: Assembly; onShowReads: (refIndex: number) => void }) {
  const d = assembly.denovo!
  const sample = assembly.samples?.[0]
  const refs = sample?.report.references ?? []
  const readSet = useEditorStore(s => (sample?.readSetId ? s.readSets.find(r => r.id === sample.readSetId) ?? null : null))
  const [peakHover, setPeakHover] = useState<number | null>(null)
  const [importing, setImporting] = useState<number | null>(null)
  const [comparing, setComparing] = useState<number | null>(null)
  // GC of each contig, read from the stored contigs.
  const [gc, setGc] = useState<number[] | null>(null)
  useEffect(() => {
    let live = true
    if (!sample) return
    Promise.all(d.contigs.map((_, i) => readReferenceBases({ get: getReadChunk }, sample.storageId, i))).then(all => {
      if (!live) return
      setGc(all.map(b => {
        let n = 0
        let gcN = 0
        for (let k = 0; k < b.length; k++) {
          const ch = b.charCodeAt(k) | 32
          if (ch === 103 || ch === 99) { gcN++; n++ } else if (ch === 97 || ch === 116) n++
        }
        return n ? gcN / n : 0
      }))
    }).catch(() => {})
    return () => { live = false }
  }, [sample, d.contigs])
  const fileRef = useRef<HTMLInputElement>(null)
  const short = d.settings.method === 'short-dbg'
  const genome = d.settings.method === 'long-olc' ? d.genome ?? null : null
  const hybrid = d.contigs.some(c => c.hybridChanges?.length)
  const total = d.contigs.reduce((n, c) => n + c.length, 0)
  const circular = d.contigs.filter(c => c.circular).length
  const fileStem = assembly.name.replace(/[\\/:*?"<>|\s]+/g, '_')

  const bases = (i: number) => {
    if (!sample) return Promise.reject(new Error('The assembly has no stored contigs'))
    return readReferenceBases({ get: getReadChunk }, sample.storageId, i)
  }
  const open = async (i: number) => {
    try {
      const c = d.contigs[i]
      const b = await bases(i)
      const title = d.contigs.length === 1 ? assembly.name : `${assembly.name} ${c.name}`
      useEditorStore.getState().openDocument(title, b, c.circular ? 'circular' : 'linear',
        `Assembled de novo from ${sample?.readSetName ?? 'reads'} (${c.circular ? 'circular' : 'linear'})`, 'consensus')
      notify.success(`Opened ${title}`)
    } catch (err) {
      notify.error('Could not open the contig', { detail: err instanceof Error ? err.message : String(err) })
    }
  }
  const exportFasta = async () => {
    try {
      const all = await Promise.all(d.contigs.map((_, i) => bases(i)))
      const text = d.contigs.map((c, i) => `>${fastaName(c.name)} length=${c.length} ${c.circular ? 'circular=true' : 'linear'}\n${all[i].replace(/(.{80})/g, '$1\n').replace(/\n$/, '')}\n`).join('')
      download(text, `${fileStem}.fasta`)
    } catch (err) {
      notify.error('Export failed', { detail: err instanceof Error ? err.message : String(err) })
    }
  }

  /** Map the reads to polished contigs from a FASTA file, and put them in place of these. */
  const importPolished = async (file: File) => {
    if (!sample || !readSet) return
    try {
      const old = await Promise.all(d.contigs.map((_, i) => bases(i)))
      const matched = matchPolished(parseFasta(await file.text()), d.contigs.map((c, i) => ({ name: c.name, fastaName: fastaName(c.name), circular: c.circular, bases: old[i] })))
      setImporting(0)
      const denovo: DeNovoReport = {
        ...d,
        contigs: d.contigs.map((c, i) => ({ ...c, length: matched[i].bases.length })),
        polished: { file: file.name, at: Date.now(), replaced: matched.filter(m => m.changed).length },
      }
      const undo = await remapContigs({
        assembly, readSet, denovo, onProgress: setImporting,
        // A polished contig that changed no longer shares its features' coordinates.
        contigs: matched.map((m, i) => ({ name: m.name, bases: m.bases, circular: m.circular, tabId: refs[i]?.tabId ?? null, features: m.changed ? undefined : refs[i]?.features })),
      })
      notify.success(`Replaced the contigs with the polished ones from ${file.name}`, undo ?{ action: { label: 'Undo', onClick: undo } } : undefined)
    } catch (err) {
      notify.error('Could not import the polished contigs', { detail: err instanceof Error ? err.message : String(err) })
    } finally {
      setImporting(null)
    }
  }

  const command = `medaka_consensus -i ${readSet ? fastaName(readSet.name) : 'reads'}.fastq.gz -d ${fileStem}.fasta -o medaka_out -m <model for your basecaller>`
  const peaks = d.peaks ?? []
  const hovered = peakHover !== null ? peaks[peakHover] : null
  const brush: [number, number] | null = hovered ? [hovered.length * (1 - PEAK_TOLERANCE), hovered.length * (1 + PEAK_TOLERANCE)] : null
  const canImport = !!sample && !!readSet && !readSet.discardedAt && !openedAsFile()

  return (
    <>
      <div className="ngs-actions">
        <button className="aw-btn" onClick={() => void exportFasta()} disabled={!sample}><Download size={13} /> Export FASTA</button>
        <button className="aw-btn" onClick={() => setComparing(0)} disabled={!sample}
          title="Compare a contig to the sequence it was expected to be: strand, start, every difference, and each feature checked">
          <GitCompareArrows size={13} /> Compare to expected…
        </button>
        <button className="aw-btn" onClick={() => fileRef.current?.click()} disabled={!canImport || importing !== null}
          title={!readSet ? 'The read set that was assembled has been deleted'
            : readSet.discardedAt ? 'The reads that were assembled have been discarded'
              : openedAsFile() ? NEEDS_WEB('minimap2')
                : 'Contigs polished outside SeqNexus (medaka, Polypolish, Pilon): the reads are mapped to them and they replace these'}>
          <Upload size={13} /> {importing !== null ? `Importing ${Math.round(importing * 100)}%` : 'Import polished contigs…'}
        </button>
        <input ref={fileRef} type="file" accept=".fasta,.fa,.fna,.fas,.txt" hidden
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importPolished(f) }} />
      </div>
      <div className="ngs-tiles">
        <Tile label={d.contigs.length === 1 ? 'Contig' : 'Contigs'} value={nf.format(d.contigs.length)}
          detail={circular === d.contigs.length ? (circular === 1 ? 'circular' : 'all circular') : circular ? `${circular} circular` : 'linear'} />
        <Tile label="Length" value={formatBp(total)} detail={d.contigs.length > 1 ? 'all contigs together' : undefined} />
        {short && d.short && <Tile label="k" value={String(d.short.k)} detail={`best of ${d.short.tried.length} tried`} />}
        {genome && <Tile label="Reads laid out" value={`${(genome.basesUsed / Math.max(1, total)).toFixed(0)}×`} detail={`${nf.format(genome.readsUsed)} longest reads`} />}
        {sample && <Tile label="Reads mapped back" value={pct(sample.report.reads ? sample.report.mapped / sample.report.reads : 0)} detail={`${nf.format(sample.report.mapped)} of ${nf.format(sample.report.reads)}`} />}
      </div>
      {d.chosen && (
        <p className="aw-note">
          {d.chosen.method === 'long-seed'
            ? `Assembled as whole products: ${pct(d.chosen.share)} of the read bases are in length peaks, full-length copies of a plasmid or an amplicon.`
            : `Assembled as a genome: ${pct(d.chosen.share)} of the read bases are in length peaks, too few for a run of whole products.`}
          {' '}Run again can choose the other way.
        </p>
      )}
      {d.polished && (
        <p className="aw-note">
          Polished outside SeqNexus: the contigs were replaced by those in {d.polished.file} on {new Date(d.polished.at).toLocaleString()}
          {' '}({d.polished.replaced} of {d.contigs.length} changed), and the reads mapped to them again.
        </p>
      )}

      <section className="ngs-card">
        <div className="ngs-card-title">Contigs</div>
        <table className="rs-table">
          <thead>
            <tr>
              <th>Contig</th>
              <th className="num">Length</th>
              <th>Shape</th>
              {short ? (
                <th className="num" title="Mean number of times its k-mers were seen">k-mer coverage</th>
              ) : genome ? (
                <th className="num" title="Reads in its layout, with the reads inside them; or the length peak it came from">Reads</th>
              ) : (
                <>
                  <th className="num" title="Reads lined up with the contig over at least 90% of it, in the last polishing round">Full-length reads</th>
                  <th className="num" title="Its share of the full-length reads: how much of the sample this product is">Share</th>
                </>
              )}
              <th className="num" title="Mean depth of all the reads mapped back">Depth</th>
              <th className="num" title="Share of G and C">GC</th>
              {!short && <th className="num" title={genome ? 'Positions each polishing round changed, the first round starting from the reads laid end to end' : 'Positions each polishing round changed, the first round starting from a single raw read'}>Polishing</th>}
              {hybrid && <th className="num" title="Positions the short reads changed in each round">Short reads</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {d.contigs.map((c, i) => (
              <tr key={c.name} className="ngs-open-row" onClick={() => onShowReads(i)} title="Show the reads along this contig">
                <td className="rs-name">
                  {c.name}
                  {(() => {
                    const m = d.matched?.find(x => x.contig === i)
                    if (!m) return null
                    const how = `Lined up with ${m.expected}${m.auto ? ' as it was assembled' : ''}: ${m.reversed ? 'reverse complemented, ' : ''}${m.shift ? `started ${nf.format(m.shift)} bases on` : 'start kept'}.`
                    const link = m.linked || !m.auto
                      ? ' Its features show over the reads.'
                      : ' It differs in length or has insertions or deletions, so its features are not drawn over the reads; Compare to expected opens it with them carried over.'
                    return <span className="ao-tag" title={how + link}>as {m.expected}</span>
                  })()}
                </td>
                <td className="num">{nf.format(c.length)} bp</td>
                <td>{c.circular ? 'Circular' : 'Linear'}</td>
                {short ? (
                  <td className="num">{c.kmerCoverage !== undefined ? `${c.kmerCoverage.toFixed(1)}×` : '-'}</td>
                ) : genome ? (
                  <td className="num">{c.fromPeak ? <span className="aw-muted" title="Too small for the overlaps: assembled whole from its peak in the read lengths">length peak</span> : c.layoutReads !== undefined ? nf.format(c.layoutReads) : '-'}</td>
                ) : (
                  <>
                    <td className="num">{c.fullLength !== undefined ? nf.format(c.fullLength) : '-'}</td>
                    <td className="num">{c.share !== undefined ? pct(c.share) : '-'}</td>
                  </>
                )}
                <td className="num">{refs[i] ? `${refs[i].meanDepth.toFixed(1)}×` : '-'}</td>
                <td className="num">{gc ? `${(gc[i] * 100).toFixed(1)}%` : ''}</td>
                {!short && <td className="num">{c.changes?.map(n => nf.format(n)).join(', ') ?? '-'}</td>}
                {hybrid && <td className="num">{c.hybridChanges?.map(n => nf.format(n)).join(', ') ?? '-'}</td>}
                <td className="ao-actions" onClick={e => e.stopPropagation()}>
                  <button className="aw-icon-btn" onClick={() => onShowReads(i)} title="Show the reads" aria-label={`Show the reads along ${c.name}`}>
                    <Rows3 size={13} />
                  </button>
                  <button className="aw-icon-btn" onClick={() => setComparing(i)} disabled={!sample}
                    title="Compare to the expected sequence" aria-label={`Compare ${c.name} to the expected sequence`}>
                    <GitCompareArrows size={13} />
                  </button>
                  <button className="aw-icon-btn" onClick={() => void open(i)} disabled={!sample}
                    title="Open as a sequence, to annotate, edit or compare" aria-label={`Open ${c.name} as a sequence`}>
                    <FilePlus2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.contigs.length > 1 && (
          <p className="aw-note">
            {short
              ? 'Several contigs: separate replicons (a chromosome and its plasmids, two plasmids), or one sequence broken where a repeat longer than the read pairs span leaves the graph more than one way on. Coverage tells them apart: a plasmid at several copies per cell has several times the depth.'
              : genome
                ? 'Several contigs: separate replicons (a chromosome and its plasmids), or one sequence broken where a repeat is longer than the reads that would span it. Circles are replicons assembled whole; the Graph page shows how the rest join.'
                : 'Several products in one sample: a mixed clone, a second plasmid, or a deletion or insertion in part of the population.'}
            {' '}Reads that disagree with a contig show up as its variants on the Reads page.
          </p>
        )}
      </section>

      {d.contigs.length > 1 && gc && refs.length === d.contigs.length && (
        <CoverageGcChart points={d.contigs.map((c, i) => ({ name: c.name, length: c.length, gc: gc[i], depth: refs[i].meanDepth }))}
          onPick={onShowReads} />
      )}

      {comparing !== null && sample && (
        <Suspense fallback={null}>
          <CompareDialog assembly={assembly} contig={comparing} onClose={() => setComparing(null)} />
        </Suspense>
      )}

      {short && d.short ? (
        <div className="ngs-charts">
          <KmerSpectrumCard spectrum={d.short.spectrum} />
          <section className="ngs-card">
            <div className="ngs-card-title">k-values tried</div>
            <table className="rs-table">
              <thead>
                <tr>
                  <th className="num">k</th>
                  <th className="num" title="k-mers seen fewer times were taken for sequencing errors">Solid from</th>
                  <th className="num">Contigs</th>
                  <th className="num">N50</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {d.short.tried.map(t => (
                  <tr key={t.k} className={t.k === d.short!.k ? 'ngs-static dn-chosen' : 'ngs-static'}>
                    <td className="num">{t.k}{t.k === d.short!.k ? ' (kept)' : ''}</td>
                    <td className="num">{t.threshold}×</td>
                    <td className="num">{nf.format(t.contigs)}</td>
                    <td className="num">{formatBp(t.n50)}</td>
                    <td className="num">{formatBp(t.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      ) : d.lengths && (
        <div className="ngs-charts">
          <HistogramChart title="Read lengths" subtitle={hovered ? `The ${nf.format(hovered.length)} bp peak highlighted` : 'Full-length reads of each product make a peak'}
            hist={d.lengths} binLabel={(lo, hi) => `${nf.format(lo)} to ${nf.format(hi - 1)} bp`} brush={brush} />
          <section className="ngs-card">
            <div className="ngs-card-title">Length peaks</div>
            <table className="rs-table">
              <thead><tr><th className="num">Length</th><th className="num">Reads</th><th>Became</th></tr></thead>
              <tbody>
                {peaks.map((p, i) => (
                  <tr key={i} className="ngs-static" onMouseEnter={() => setPeakHover(i)} onMouseLeave={() => setPeakHover(null)}>
                    <td className="num">{nf.format(p.length)} bp</td>
                    <td className="num">{nf.format(p.reads)}</td>
                    <td className="rs-issues">{p.contig !== null ? d.contigs[p.contig]?.name : <span className="aw-muted">Left out: {p.dropped}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      <section className="ngs-card">
        <div className="ngs-card-title">How it was made</div>
        <dl className="ngs-facts">
          <dt>Reads</dt>
          <dd>{readSet
            ? <button className="ngs-link" onClick={() => useEditorStore.getState().setActiveReadSet(readSet.id)}>{readSet.name}</button>
            : <span>{sample?.readSetName ?? 'Reads'} <span className="aw-muted">(deleted)</span></span>}
            {' '}<span className="aw-muted">{nf.format(d.reads)} reads</span></dd>
          <dt>Method</dt><dd>{DENOVO_METHOD_LABEL[d.settings.method]}</dd>
          {short && d.short ? (
            <>
              <dt>Reads used</dt>
              <dd className="aw-muted">
                {nf.format(d.short.readsUsed)} reads ({formatBp(d.short.basesUsed)}), sampled down to about 100× of the genome length
                the k-mers give (at most 300 Mb){d.short.pairs ? '.' : '; pairs used as single reads.'}
              </dd>
              <dt>Graph</dt>
              <dd className="aw-muted">
                k-mers seen at least {d.short.threshold} times at k {d.short.k}; {nf.format(d.short.cleaned)} tips, bubbles and low-coverage
                pieces removed (sequencing errors, and at a mixed site the minority); contigs of {nf.format(d.short.minContig)} bp or more kept.
              </dd>
              {d.short.pairs && (
                <>
                  <dt>Pairs</dt>
                  <dd className="aw-muted">
                    {d.short.pairs.insert
                      ? <>Insert {nf.format(d.short.pairs.insert)} ± {nf.format(Math.round(d.short.pairs.insertSd))} bp, from {nf.format(d.short.pairs.placed)} pairs
                        {' '}on one unitig. {nf.format(d.short.pairs.linking)} pairs linked two contigs: {nf.format(d.short.pairs.joins)} {d.short.pairs.joins === 1 ? 'join' : 'joins'} across
                        {' '}repeats shorter than the insert, where one path through the graph fits the pairs&apos; distance
                        {d.short.pairs.unresolved ? `; ${nf.format(d.short.pairs.unresolved)} contig ${d.short.pairs.unresolved === 1 ? 'end' : 'ends'} linked but left apart (no single path fits, or the links disagree)` : ''}.</>
                      : 'Too few pairs lay on one contig to measure the insert, so none were joined.'}
                  </dd>
                </>
              )}
            </>
          ) : genome ? (
            <>
              <dt>Reads used</dt>
              <dd className="aw-muted">
                The {nf.format(genome.readsUsed)} longest reads ({formatBp(genome.basesUsed)},
                {' '}{d.settings.genomeSize ? `about 40× of the ${formatBp(d.settings.genomeSize)} genome given` : 'up to 200 Mb, no genome length being given'}),
                {' '}leaving out the tenth of lowest quality.
              </dd>
              <dt>Overlaps</dt>
              <dd className="aw-muted">
                {nf.format(genome.overlaps)} overlaps of at least {nf.format(genome.minOverlap)} bases, every read against every other
                (minimap2 -x {sample?.report.preset === 'map-hifi' ? 'ava-pb' : 'ava-ont'}).
              </dd>
              <dt>Layout</dt>
              <dd className="aw-muted">
                A string graph, as miniasm builds it: {nf.format(genome.trimmedAway)} reads too little covered by others left out,
                {' '}{nf.format(genome.contained)} inside longer reads set aside; {nf.format(genome.cleaned.transitive)} transitive
                {' '}overlaps, {nf.format(genome.cleaned.tips)} reads in tips, {nf.format(genome.cleaned.shortOverlaps)} short overlaps at
                {' '}branches and {nf.format(genome.cleaned.bubbles)} reads in bubbles removed; {nf.format(genome.unitigs)} unitigs.
                {genome.circularized ? ` ${genome.circularized} linear ${genome.circularized === 1 ? 'unitig whose end repeated its start was' : 'unitigs whose ends repeated their starts were'} cut to one turn of a circle.` : ''}
                {genome.duplicates ? ` ${genome.duplicates} ${genome.duplicates === 1 ? 'unitig was a copy' : 'unitigs were copies'} of another (a small plasmid laid out more than once) and left out.` : ''}
              </dd>
              <dt>Polishing</dt>
              <dd className="aw-muted">
                The same reads aligned to the unitigs (minimap2), majority consensus, up to {d.settings.rounds} rounds:
                {' '}{genome.polishChanges.map(n => nf.format(n)).join(', ')} positions changed.
              </dd>
              {genome.fromPeaks > 0 && (
                <>
                  <dt>Small replicons</dt>
                  <dd className="aw-muted">
                    {genome.fromPeaks} from length peaks in the reads (seed and polish), too small for the overlaps.
                  </dd>
                </>
              )}
              {genome.hybrid && (
                <>
                  <dt>Short reads</dt>
                  <dd className="aw-muted">
                    {nf.format(genome.hybrid.reads)} reads of {genome.hybrid.readSet} mapped to the contigs (minimap2 -x sr), a position
                    {' '}changed where more than half of at least 5 reads disagree: {genome.hybrid.changes.map(n => nf.format(n)).join(', ')} positions
                    {' '}changed by round.
                  </dd>
                </>
              )}
            </>
          ) : (
            <>
              <dt>Peaks</dt>
              <dd className="aw-muted">
                Read lengths within {Math.round(PEAK_TOLERANCE * 100)}% of each other, at least {d.settings.minReads} reads above what the
                lengths around them would put there, and too many to be chance.
              </dd>
              <dt>Seeds</dt><dd>{d.contigs.map(c => `${c.name}: ${c.seed ?? '-'}`).join(', ')}</dd>
              <dt>Polishing</dt>
              <dd className="aw-muted">
                minimap2 then majority consensus, up to {d.settings.rounds} rounds, stopping when a round changes nothing. The first round
                uses each product&apos;s own peak reads; later rounds use the {nf.format(d.polishReads ?? 0)} best reads against every contig at once.
              </dd>
            </>
          )}
          <dt>Accuracy</dt>
          <dd className="aw-muted">
            {short
              ? `Each base is what the solid k-mers agree on, which on Illumina reads is usually exact; repeats longer than ${d.short?.pairs?.insert ? 'the insert' : 'k'} and stretches of low coverage break contigs rather than being guessed.`
              : genome?.hybrid
                ? 'A majority consensus of the long reads, corrected by the short reads where they clearly disagree: homopolymer lengths and other errors the long reads share. In repeats longer than the short reads, those cannot tell the copies apart, and the long reads\' consensus stays.'
                : 'A majority consensus of the reads. On nanopore reads it can still have homopolymer runs one base short or long where most reads get them wrong the same way.'}
          </dd>
        </dl>
      </section>

      <section className="ngs-card">
        <div className="ngs-card-title">Polish with medaka, or another polisher</div>
        <p className="aw-note">
          {short
            ? 'Short-read contigs rarely need it, but Polypolish or Pilon can be run on the exported contigs and reads, and their FASTA imported here.'
            : 'medaka corrects the homopolymer errors a majority consensus leaves in nanopore contigs. It runs on Linux and macOS (SeqNexus cannot include it: its licence allows research use only). Export the contigs (Export FASTA) and the reads (Export on the read set\'s page), run medaka with the model for your basecaller, then import its consensus.fasta here: the reads are mapped to the polished contigs, which replace these (Undo puts them back).'}
        </p>
        {!short && (
          <div className="dn-command">
            <code>{command}</code>
            <button className="aw-icon-btn" title="Copy the command" aria-label="Copy the medaka command"
              onClick={() => { void navigator.clipboard?.writeText(command).then(() => notify.success('Copied the command')) }}>
              <Copy size={13} />
            </button>
          </div>
        )}
      </section>
    </>
  )
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="ngs-tile">
      <div className="ngs-tile-label">{label}</div>
      <div className="ngs-tile-value">{value}</div>
      {detail && <div className="ngs-tile-detail">{detail}</div>}
    </div>
  )
}
