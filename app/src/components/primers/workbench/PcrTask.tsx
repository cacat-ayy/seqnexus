/**
 * PCR: design a pair (and optionally a probe) around a target. The design
 * re-runs as the target and settings change; results are the candidate
 * track plus the best pairs, and either side can be picked on its own.
 */

import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useEditorStore } from '../../../store'
import { designPrimersAsync, cancelPrimerDesign } from '../../../workers/primer-design'
import {
  PRESETS, applyPreset, primerConstraints, probeConstraints, settingsProblem,
  type DesignSettings, type PresetId,
} from '../../../primers/design/settings'
import type { Region } from '../../../primers/design/types'
import { penaltyQuality as quality } from '../../../primers/display'
import { useDesignPreview, designOligoId } from '../../../primers/usePrimerSites'
import DesignTrack from '../DesignTrack'
import { TargetField } from './TargetField'
import { fmtRegion, useSelectionTarget } from './target'
import PicksPanel from './PicksPanel'

const DEBOUNCE_MS = 350

export default function PcrTask({ settings, onSettings }: {
  settings: DesignSettings
  onSettings: (s: DesignSettings) => void
}) {
  const doc = useEditorStore(s => s.doc)
  const design = useEditorStore(s => s.primerDesign)
  const setDesignResult = useEditorStore(s => s.setDesignResult)
  const setDesignPicks = useEditorStore(s => s.setDesignPicks)

  const n = doc.sequence.length
  const circular = doc.sequence.topology === 'circular'
  const bases = doc.sequence.bases
  const template = useMemo(() => bases.toUpperCase(), [bases])

  const t = useSelectionTarget()
  const target = t.target
  const [excluded, setExcluded] = useState<Region[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => () => cancelPrimerDesign(), [])

  const problem = !target ? null : settingsProblem(settings)

  const request = useMemo(() => {
    if (!target || problem || n === 0) return null
    return {
      template,
      topology: doc.sequence.topology,
      target,
      excluded,
      minProductSize: settings.minProduct,
      maxProductSize: settings.maxProduct,
      constraints: primerConstraints(settings),
      probe: settings.probe ? probeConstraints(settings) : null,
      maxPairs: 20,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.start, target?.end, problem, n, template, doc.sequence.topology, excluded, settings])

  useEffect(() => {
    if (!request) { setBusy(false); return }
    setBusy(true)
    let live = true
    const timer = setTimeout(() => {
      designPrimersAsync(request).then(result => {
        if (!live || !result) return
        setDesignResult(result)
        setBusy(false)
      })
    }, DEBOUNCE_MS)
    return () => { live = false; clearTimeout(timer) }
  }, [request, setDesignResult])

  const preview = useDesignPreview(doc, design.picks)
  const siteOf = (role: 'forward' | 'reverse' | 'probe', strand?: 1 | -1) =>
    (preview.sites.get(designOligoId(role)) ?? []).find(s => strand === undefined || s.strand === strand) ?? null

  const result = design.result
  const activePair = result?.pairs.findIndex(p =>
    p.forward.sequence === design.picks.forward && p.reverse.sequence === design.picks.reverse) ?? -1

  const pickPair = (i: number) => {
    const pair = result?.pairs[i]
    if (!pair) return
    setDesignPicks({
      forward: pair.forward.sequence,
      reverse: pair.reverse.sequence,
      probe: pair.probe?.sequence ?? null,
    })
  }

  return (
    <>
      <section className="wb-section">
        <div className="wb-row">
          <label htmlFor="wb-preset">Preset</label>
          <select
            id="wb-preset"
            className="input ft-select"
            value={settings.preset}
            onChange={e => onSettings(applyPreset(settings, e.target.value as PresetId))}
          >
            {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            {settings.preset === 'custom' && <option value="custom">Custom</option>}
          </select>
        </div>
        <div className="wb-hint">{PRESETS.find(p => p.id === settings.preset)?.hint ?? 'Edited by hand'}</div>

        <TargetField label="Target" hint="Select the region the product must contain." t={t} n={n} />

        <div className="wb-row">
          <label>Avoid</label>
          <button
            className="btn btn-sm"
            disabled={!t.selection || t.selection.start === t.selection.end}
            onClick={() => t.selection && setExcluded(x => [...x, t.selection!])}
            title="Keep primers out of the selected bases, e.g. a repeat or a SNP"
          >
            <Plus size={11} /> Selection
          </button>
        </div>
        {excluded.length > 0 && (
          <div className="wb-chips">
            {excluded.map((r, i) => (
              <span key={i} className="wb-chip">
                {fmtRegion(r)}
                <button aria-label={`Stop avoiding ${fmtRegion(r)}`} onClick={() => setExcluded(x => x.filter((_, j) => j !== i))}>
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="wb-section">
        <div className="wb-status" aria-live="polite">
          {problem ?? (busy ? 'Designing…'
            : result?.error ?? (result
              ? `${result.counts.forward} forward · ${result.counts.reverse} reverse candidates · ${result.pairs.length} pairs`
              : target ? '' : 'Select a region on the sequence to design primers around it.'))}
        </div>
        {result && !problem && (result.forward.length > 0 || result.reverse.length > 0) && (
          <DesignTrack
            result={result}
            excluded={excluded}
            circular={circular}
            picked={{ forward: siteOf('forward', 1), reverse: siteOf('reverse', -1), probe: siteOf('probe') }}
            onPick={(role, c) => setDesignPicks({ [role]: c.sequence })}
          />
        )}
        {result && result.pairs.length > 0 && (
          <ol className="wb-pairs" aria-label="Best pairs">
            {result.pairs.map((p, i) => (
              <li key={i}>
                <button className={i === activePair ? 'active' : ''} onClick={() => pickPair(i)}>
                  <span className={`wb-dot ${quality(p.penalty)}`} />
                  <span className="wb-pair-rank">#{i + 1}</span>
                  <span>{p.evaluation.productSize} bp</span>
                  <span className="wb-pair-meta">
                    {p.forward.tm.toFixed(1)}/{p.reverse.tm.toFixed(1)} °C{p.probe ? ' · probe' : ''}
                  </span>
                  <span className="wb-pair-score">{p.penalty.toFixed(1)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
      <PicksPanel settings={settings} />
    </>
  )
}
