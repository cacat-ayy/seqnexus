/**
 * Analyse: what the experiment actually did.
 *
 * Two routes to one answer. A pair of chromatograms, control against edited,
 * taken apart into the mixture of length changes that explains the edited
 * one. Or amplicon reads, each judged on a window around the break and
 * grouped into alleles. Which evidence you have decides the route; the
 * result is shown the same way either side.
 *
 * The cut comes from the selected guide when there is one, because that is
 * the break being asked about, and otherwise from the caret, so a trace can
 * be read without having designed anything in this session.
 */

import { useMemo, useState } from 'react'
import { Activity } from 'lucide-react'
import { useEditorStore } from '../../../store'
import { decomposeTraces, DEFAULT_DECOMPOSE } from '../../../crispr/analysis/decompose'
import { DEFAULT_ALLELES } from '../../../crispr/analysis/alleles'
import { sampleReadSet, readsFromText, DEFAULT_SAMPLE } from '../../../crispr/analysis/readsource'
import { callAllelesAsync } from '../../../workers/crispr'
import { cutPosition } from '../../../crispr/finder'
import { guideKey } from '../../../utils/guide-features'
import { displayPosition } from '../../../models/Document'
import { selectionRange } from '../../../models/selection'
import { notify } from '../../../toast'
import AnalysisResult from '../AnalysisResult'
import type { GuideCandidate, Nuclease } from '../../../crispr/types'

interface Props {
  candidates: readonly GuideCandidate[]
  nuclease: Nuclease
}

type Route = 'traces' | 'reads'

export default function AnalyseTask({ candidates, nuclease }: Props) {
  const [route, setRoute] = useState<Route>('traces')
  const [controlId, setControlId] = useState('')
  const [editedId, setEditedId] = useState('')
  const [readSetId, setReadSetId] = useState('')
  const [pasted, setPasted] = useState('')
  const [donor, setDonor] = useState('')
  const [window, setWindow] = useState(DEFAULT_ALLELES.window)
  const [busy, setBusy] = useState(false)

  const doc = useEditorStore(s => s.doc)
  const reads = useEditorStore(s => s.sequencingReads)
  const readSets = useEditorStore(s => s.readSets)
  const selection = useEditorStore(s => s.selection)
  const selectedKey = useEditorStore(s => s.selectedGuideKey)
  const analysis = useEditorStore(s => s.crisprAnalysis)
  const setAnalysis = useEditorStore(s => s.setCrisprAnalysis)
  const origin = doc.metadata?.displayOrigin ?? 0
  const at = (i: number) => displayPosition(i, origin, doc.sequence.length)

  const candidate = useMemo(
    () => candidates.find(c => guideKey(c.site) === selectedKey) ?? null,
    [candidates, selectedKey],
  )
  const range = selectionRange(selection)
  // A selected span starts at the break; with nothing selected the caret is
  // the break, which is what the panel tells the user.
  const cut = candidate
    ? cutPosition(candidate.site, doc.sequence.length, doc.sequence.topology === 'circular')
    : range?.[0] ?? (doc.sequence.length > 0 ? selection.caret : null)

  const control = reads.find(r => r.id === controlId)
  const edited = reads.find(r => r.id === editedId)

  const runTraces = () => {
    if (!control || !edited || cut === null) return
    // The cut is given in the document's coordinates; a trace is its own
    // sequence, so it is found in the trace by its bases.
    const traceCut = control.data.bases.toUpperCase().indexOf(
      doc.sequence.bases.slice(Math.max(0, cut - 20), cut).toUpperCase(),
    )
    const cutInTrace = traceCut >= 0 ? traceCut + Math.min(20, cut) : cut
    const result = decomposeTraces(control.data, edited.data, cutInTrace, DEFAULT_DECOMPOSE)
    if (!result) {
      notify.error('These traces cannot be taken apart at that position.')
      return
    }
    setAnalysis({
      kind: 'traces',
      source: {
        description: `${edited.data.name || 'edited'} against ${control.data.name || 'control'}, `
          + `cut at ${at(cut)}.`,
        cut,
        ...(candidate ? { spacer: candidate.site.spacer } : {}),
        when: Date.now(),
      },
      result,
    })
  }

  const runReads = async () => {
    if (cut === null) return
    setBusy(true)
    try {
      const fromText = pasted.trim().length > 0 ? readsFromText(pasted, window) : []
      const set = readSets.find(r => r.id === readSetId)
      const sample = fromText.length > 0
        ? { reads: fromText, available: fromText.length, sampled: false }
        : set
          ? await sampleReadSet(set.id, set.chunks, DEFAULT_SAMPLE, window)
          : { reads: [], available: 0, sampled: false }
      if (sample.reads.length === 0) {
        notify.warning('No reads to look at. Choose a read set, or paste some.')
        return
      }
      const { table, conversion } = await callAllelesAsync({
        reads: sample.reads,
        amplicon: doc.sequence.bases,
        cut,
        settings: { ...DEFAULT_ALLELES, window },
        ...(donor.trim() ? { donor: donor.toUpperCase().replace(/[^ACGT]/g, '') } : {}),
        conversion: true,
      })
      setAnalysis({
        kind: 'reads',
        source: {
          description: `${sample.reads.length.toLocaleString()} reads against ${doc.name}, cut at ${at(cut)}.`,
          cut,
          ...(candidate ? { spacer: candidate.site.spacer } : {}),
          when: Date.now(),
        },
        table,
        conversion,
        sample: { used: sample.reads.length, available: sample.available, sampled: sample.sampled },
      })
    } catch {
      notify.error('The reads could not be analysed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="gp-settings gp-settings-tight">
        <div className="gp-field gp-field-wide">
          <label htmlFor="gp-route">Evidence</label>
          <select id="gp-route" value={route} onChange={e => setRoute(e.target.value as Route)}>
            <option value="traces">A control trace and an edited one</option>
            <option value="reads">Amplicon reads</option>
          </select>
        </div>

        {route === 'traces' ? (
          <>
            <div className="gp-field gp-field-wide">
              <label htmlFor="gp-control">Control</label>
              <select id="gp-control" value={controlId} onChange={e => setControlId(e.target.value)}>
                <option value="">Choose a trace</option>
                {reads.map(r => <option key={r.id} value={r.id}>{r.data.name || r.id}</option>)}
              </select>
            </div>
            <div className="gp-field gp-field-wide">
              <label htmlFor="gp-edited">Edited</label>
              <select id="gp-edited" value={editedId} onChange={e => setEditedId(e.target.value)}>
                <option value="">Choose a trace</option>
                {reads.map(r => <option key={r.id} value={r.id}>{r.data.name || r.id}</option>)}
              </select>
            </div>
            {reads.length === 0 && (
              <p className="gp-note gp-warn">
                No chromatograms are open. Drop the control and the edited ab1 files in first.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="gp-field gp-field-wide">
              <label htmlFor="gp-readset">Read set</label>
              <select id="gp-readset" value={readSetId} onChange={e => setReadSetId(e.target.value)}>
                <option value="">Choose a read set</option>
                {readSets.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="gp-field gp-field-wide">
              <label htmlFor="gp-pasted">Or paste reads</label>
              <textarea
                id="gp-pasted"
                className="input gp-payload"
                value={pasted}
                onChange={e => setPasted(e.target.value)}
                rows={2}
                spellCheck={false}
                placeholder="FASTA, FASTQ, or one read per line"
              />
            </div>
            <div className="gp-field gp-field-wide">
              <label htmlFor="gp-donor">Donor, if one was used</label>
              <input
                id="gp-donor"
                className="input gp-payload"
                value={donor}
                onChange={e => setDonor(e.target.value)}
                spellCheck={false}
                placeholder="The sequence that was meant to go in"
              />
            </div>
            <div className="gp-field">
              <label htmlFor="gp-window">Window</label>
              <select id="gp-window" value={window} onChange={e => setWindow(Number(e.target.value))}>
                {[10, 20, 30, 50].map(w => <option key={w} value={w}>{w} bp either side</option>)}
              </select>
            </div>
          </>
        )}

        <p className="gp-note">
          {cut === null
            ? 'Select a guide, or put the caret where the break is.'
            : `The break is taken to be at ${at(cut)}${candidate ? `, the cut of ${candidate.site.spacer}` : ''}.`}
          {route === 'reads' && ' Only reads spanning the whole window are counted.'}
        </p>
      </div>

      <div className="gp-run-row">
        <button
          className="btn btn-primary btn-sm"
          disabled={busy || cut === null || (route === 'traces' ? !control || !edited : false)}
          onClick={() => { if (route === 'traces') runTraces(); else void runReads() }}
        >
          <Activity size={12} /> {busy ? 'Reading…' : 'Analyse'}
        </button>
        {analysis && (
          <button className="btn btn-sm" onClick={() => setAnalysis(null)}>Clear</button>
        )}
      </div>

      {analysis && <AnalysisResult analysis={analysis} />}
      {!analysis && (
        <p className="gp-note gp-note-row">
          {nuclease.cleaves === 'none'
            ? 'This nuclease does not cut, so there is no break to read.'
            : 'Nothing read yet.'}
        </p>
      )}
    </>
  )
}
