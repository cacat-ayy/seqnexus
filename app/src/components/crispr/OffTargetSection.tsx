/**
 * The off-target controls: what to search, how hard, and the button that
 * does it.
 *
 * The scope is the first control rather than a buried setting, because it is
 * the part that decides what the resulting number means. A specificity score
 * from one plasmid and one from a chromosome look identical, so the scope is
 * chosen here and named again next to every result.
 */

import { useRef, useState } from 'react'
import { Crosshair, FileUp, X } from 'lucide-react'
import { useEditorStore } from '../../store'
import { useOffTargetRun } from '../../hooks/useOffTargetRun'
import { loadTargetFile, SCOPE_LABEL, type TargetScope } from '../../crispr/targets'
import { MAX_MISMATCHES } from '../../crispr/offtarget'
import { notify } from '../../toast'
import Chevron from '../Chevron'

interface Props {
  /** Guide keys the user has picked, searched together when there are any. */
  pickedKeys: readonly string[]
  hasSelection: boolean
}

export default function OffTargetSection({ pickedKeys, hasSelection }: Props) {
  const scope = useEditorStore(s => s.offTargetScope)
  const settings = useEditorStore(s => s.offTargetSettings)
  const file = useEditorStore(s => s.offTargetFile)
  const setFile = useEditorStore(s => s.setOffTargetFile)
  const setParams = useEditorStore(s => s.setOffTargetParams)
  const progress = useEditorStore(s => s.offTargetRun)
  const { run, ready } = useOffTargetRun()
  const fileRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  // Collapsed to start: the candidate list is what the panel is for, and the
  // search is a deliberate act with settings worth reading before it runs.
  const [open, setOpen] = useState(false)

  const pickFile = async (f: File | undefined) => {
    if (!f) return
    setLoading(true)
    try {
      const loaded = loadTargetFile(await f.text(), f.name)
      if ('message' in loaded) {
        notify.error(loaded.message)
        return
      }
      setFile(loaded)
      setParams({ offTargetScope: 'file' })
    } catch {
      notify.error('That file could not be read.')
    } finally {
      setLoading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const count = pickedKeys.length
  const label = count > 1 ? `Check ${count} guides` : 'Check off-targets'

  return (
    <div className="gp-section">
      <button
        className="gp-section-toggle"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <Chevron open={open} size={12} />
        <span className="gp-section-title">Off-targets</span>
        <span className="gp-section-hint">{SCOPE_LABEL[scope]}{progress ? ', searching' : ''}</span>
      </button>

      {!open ? null : (
        <div className="disclose">
      <div className="gp-settings gp-settings-tight">
        <div className="gp-field gp-field-wide">
          <label htmlFor="gp-scope">Search in</label>
          <select
            id="gp-scope"
            value={scope}
            onChange={e => setParams({ offTargetScope: e.target.value as TargetScope })}
          >
            {(Object.keys(SCOPE_LABEL) as TargetScope[]).map(s => (
              <option key={s} value={s}>{SCOPE_LABEL[s]}</option>
            ))}
          </select>
        </div>

        {scope === 'file' && (
          <div className="gp-field gp-field-wide">
            <div className="gp-file-row">
              <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={loading}>
                <FileUp size={12} /> {file ? 'Replace file' : 'Load FASTA'}
              </button>
              {file && (
                <>
                  <span className="gp-file-name" title={file.fileName}>
                    {file.fileName}, {file.records.length} record{file.records.length === 1 ? '' : 's'},{' '}
                    {file.totalBases >= 1_000_000
                      ? `${(file.totalBases / 1_000_000).toFixed(1)} Mb`
                      : `${Math.round(file.totalBases / 1000)} kb`}
                  </span>
                  <button className="fs-icon-btn" onClick={() => setFile(null)} title="Forget this file">
                    <X size={12} />
                  </button>
                </>
              )}
            </div>
            <input
              ref={fileRef}
              data-testid="offtarget-file"
              type="file"
              accept=".fa,.fasta,.fna,.fas,.txt,.seq"
              hidden
              onChange={e => { void pickFile(e.target.files?.[0]) }}
            />
          </div>
        )}

        <div className="gp-field">
          <label htmlFor="gp-mm">Mismatches</label>
          <select
            id="gp-mm"
            value={settings.maxMismatches}
            onChange={e => setParams({ offTargetSettings: { ...settings, maxMismatches: Number(e.target.value) } })}
          >
            {Array.from({ length: MAX_MISMATCHES + 1 }, (_, i) => (
              <option key={i} value={i}>up to {i}</option>
            ))}
          </select>
        </div>

        <div className="gp-checks">
          <label className="gp-check" title="Also look for sites with one unpaired base. Slower, and they do happen.">
            <input
              type="checkbox"
              checked={settings.bulges}
              onChange={e => setParams({ offTargetSettings: { ...settings, bulges: e.target.checked } })}
            />
            Allow a bulge
          </label>
          <label className="gp-check" title="Also search the weaker PAMs this nuclease will bind.">
            <input
              type="checkbox"
              checked={settings.alternativePams}
              onChange={e => setParams({ offTargetSettings: { ...settings, alternativePams: e.target.checked } })}
            />
            Weaker PAMs
          </label>
        </div>

        <p className="gp-note">
          The search looks only at the sequences you choose here. It cannot tell you about a genome it has
          not been given, so a high score means this guide has little else to bind in what was searched.
        </p>
      </div>

      <div className="gp-run-row">
        <button
          className="btn btn-primary btn-sm"
          onClick={() => void run(pickedKeys.length > 0 ? pickedKeys : undefined)}
          disabled={!ready || (!hasSelection && pickedKeys.length === 0)}
          title={pickedKeys.length > 0
            ? 'Search for every picked guide'
            : 'Search for the selected guide'}
        >
          <Crosshair size={12} /> {label}
        </button>
        {progress && (
          <span className="gp-progress">
            {progress.guidesTotal > 1 && `Guide ${progress.guidesDone + 1} of ${progress.guidesTotal}, `}
            {progress.targetName
              ? `searching ${progress.targetName} (${progress.targetsDone + 1} of ${progress.targetsTotal})`
              : 'finishing'}
          </span>
        )}
      </div>
        </div>
      )}
    </div>
  )
}
