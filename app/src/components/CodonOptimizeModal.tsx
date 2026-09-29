import './CodonOptimizeModal.css'
/**
 * Codon optimization.
 *
 * Settings on the left, the consequences on the right, recomputed as the
 * settings change. Nothing touches the document until Apply: a preview that
 * costs nothing to look at is what makes the constraint options usable, since
 * the only way to know whether a GC window is achievable is to try it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, Loader2, ChevronDown, ChevronRight, Upload, Trash2 } from 'lucide-react'
import { useEditorStore } from '../store'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'
import { ENZYME_GROUPS } from '../enzymes/db'
import { GENETIC_CODES, geneticCode } from '../codon/genetic-codes'
import {
  BUILTIN_USAGE_TABLES, DERIVED_TABLE_ID, deriveFromCds, type CodonUsageTable,
} from '../codon/usage-tables'
import { parseUsageTable, describeUsageImport, UsageImportError } from '../codon/usage-import'
import { MOTIF_PRESETS } from '../codon/constraints'
import { codingFeatures } from '../codon/targets'
import {
  constraintSetFor, motifsFor, targetOptionsFor, DEFAULT_CODON_SETTINGS,
} from '../codon/settings'
import { combinedMetrics, runOptimization, type OptimizationRun } from '../codon/run'
import { notify } from '../toast'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'

interface Props {
  open: boolean
  onClose: () => void
}

/** Past this many bases a run is only made on request, not while typing. */
const AUTO_RUN_LIMIT = 60_000
const IMPORT_ACCEPT = '.txt,.csv,.tsv,.tab,.dat'

function formatMetric(value: number | null, digits = 1, suffix = ''): string {
  if (value === null || Number.isNaN(value)) return '-'
  return value.toFixed(digits) + suffix
}

/** One before/after row of the summary table. */
function MetricRow(
  { label, before, after, format, higherIsBetter }: {
    label: string
    before: number | null
    after: number | null
    format: (v: number | null) => string
    higherIsBetter?: boolean
  },
) {
  const changed = before !== null && after !== null && Math.abs(after - before) > 1e-9
  const better = changed && higherIsBetter !== undefined && before !== null && after !== null
    ? (higherIsBetter ? after > before : after < before)
    : null
  return (
    <tr>
      <td>{label}</td>
      <td className="cod-num">{format(before)}</td>
      <td className={`cod-num ${better === true ? 'better' : better === false ? 'worse' : ''}`}>
        {format(after)}
      </td>
    </tr>
  )
}

export default function CodonOptimizeModal({ open, onClose }: Props) {
  const doc = useEditorStore(s => s.doc)
  const selection = useEditorStore(s => s.selection)
  const readOnly = useEditorStore(s => s.readOnly)
  const settings = useEditorStore(s => s.codonSettings)
  const setSettings = useEditorStore(s => s.setCodonSettings)
  const customTables = useEditorStore(s => s.customUsageTables)
  const loadCustomUsageTables = useEditorStore(s => s.loadCustomUsageTables)
  const addCustomUsageTable = useEditorStore(s => s.addCustomUsageTable)
  const removeCustomUsageTable = useEditorStore(s => s.removeCustomUsageTable)
  const substituteBases = useEditorStore(s => s.substituteBases)
  const openDocumentState = useEditorStore(s => s.openDocumentState)

  const [featureIds, setFeatureIds] = useState<Set<string>>(new Set())
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [enzymeQuery, setEnzymeQuery] = useState('')
  const [result, setResult] = useState<OptimizationRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [tableMessage, setTableMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [manualRun, setManualRun] = useState(0)
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) void loadCustomUsageTables() }, [open, loadCustomUsageTables])

  const features = useMemo(() => codingFeatures(doc.annotations), [doc.annotations])
  const code = useMemo(() => geneticCode(settings.geneticCodeId), [settings.geneticCodeId])

  /** The table derived from this document, rebuilt when its features change. */
  const derived = useMemo(
    () => (open ? deriveFromCds(doc.annotations, doc.sequence, code) : null),
    [open, doc.annotations, doc.sequence, code],
  )

  const table: CodonUsageTable | null = useMemo(() => {
    if (settings.usageTableId === DERIVED_TABLE_ID) return derived?.table ?? null
    return BUILTIN_USAGE_TABLES.find(t => t.id === settings.usageTableId)
      ?? customTables.find(t => t.id === settings.usageTableId)
      ?? null
  }, [settings.usageTableId, derived, customTables])

  const selectionRange = selection.anchor !== selection.caret
    ? { start: Math.min(selection.anchor, selection.caret), end: Math.max(selection.anchor, selection.caret) }
    : null

  /** How much sequence the current target covers, for the size guard. */
  const targetSize = settings.target === 'selection'
    ? (selectionRange ? selectionRange.end - selectionRange.start : 0)
    : settings.target === 'whole'
      ? doc.sequence.length
      : features
        .filter(f => featureIds.size === 0 || featureIds.has(f.id))
        .reduce((n, f) => n + Math.abs(f.end - f.start), 0)

  const autoRun = targetSize <= AUTO_RUN_LIMIT

  // Recompute on a short delay: every slider drag would otherwise run the
  // optimizer on each frame.
  useEffect(() => {
    if (!open || !table) { setResult(null); return }
    if (!autoRun && manualRun === 0) { setResult(null); return }

    let cancelled = false
    setRunning(true)
    const timer = setTimeout(() => {
      try {
        const run = runOptimization({
          kind: settings.target,
          sequence: doc.sequence,
          annotations: doc.annotations,
          code,
          table,
          constraints: constraintSetFor(settings),
          targetOptions: targetOptionsFor(settings),
          optimizeOptions: {
            mode: settings.mode,
            strategy: settings.strategy,
            rareThreshold: settings.rareThreshold,
            seed: settings.seed,
            backtrackBudget: 20_000,
          },
          selection: selectionRange,
          featureIds,
        })
        if (cancelled) return
        setResult(run)
        setError(null)
      } catch (e) {
        if (cancelled) return
        setResult(null)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setRunning(false)
      }
    }, 200)

    return () => { cancelled = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectionRange is rebuilt each render; its values are covered by `selection`
  }, [open, table, code, settings, featureIds, doc.sequence, doc.annotations, selection, autoRun, manualRun])

  const before = useMemo(() => result ? combinedMetrics(result.regions, 'before') : null, [result])
  const after = useMemo(() => result ? combinedMetrics(result.regions, 'after') : null, [result])

  const patch = useCallback(
    (p: Partial<typeof settings>) => setSettings(p),
    [setSettings],
  )

  const toggleIn = (list: string[], value: string) =>
    list.includes(value) ? list.filter(v => v !== value) : [...list, value]

  const handleImport = useCallback((file: File | undefined) => {
    if (!file) return
    file.text()
      .then(text => {
        const parsed = parseUsageTable(file.name, text)
        const id = addCustomUsageTable(parsed.table)
        patch({ usageTableId: id })
        setTableMessage({ text: describeUsageImport(file.name, parsed), error: false })
      })
      .catch((e: unknown) => {
        setTableMessage({
          text: e instanceof UsageImportError ? e.message : `Could not read "${file.name}".`,
          error: true,
        })
      })
  }, [addCustomUsageTable, patch])

  /** Apply every edit as one undoable change to the open document. */
  const handleApply = useCallback(() => {
    if (!result || result.edits.length === 0) return
    if (substituteBases(result.edits)) {
      notify.success(
        `Optimized ${result.totalChanges} codon${result.totalChanges === 1 ? '' : 's'} in ${result.regions.length} region${result.regions.length === 1 ? '' : 's'}`,
      )
      onClose()
    }
  }, [result, substituteBases, onClose])

  /** Put the result in a new tab and leave this document alone. */
  const handleOpenCopy = useCallback(() => {
    if (!result || result.edits.length === 0) return
    const chars = doc.sequence.bases.split('')
    for (const edit of result.edits) {
      for (let i = 0; i < edit.bases.length; i++) chars[edit.start + i] = edit.bases[i]
    }
    openDocumentState({
      name: `${doc.name} (optimized)`,
      description: doc.description,
      sequence: new Sequence(chars.join(''), doc.sequence.topology),
      annotations: doc.annotations.map(a => new Annotation(a.toData())),
      metadata: doc.metadata,
    })
    notify.success(`Opened "${doc.name} (optimized)"`)
    onClose()
  }, [result, doc, openDocumentState, onClose])

  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)
  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }, [onClose])
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null

  const motifCount = motifsFor(settings).length
  const violationSummary = new Map<string, number>()
  for (const region of result?.regions ?? []) {
    for (const v of region.violations) {
      violationSummary.set(v.kind, (violationSummary.get(v.kind) ?? 0) + 1)
    }
  }

  return (
    <div
      className={closing ? 'modal-backdrop closing' : 'modal-backdrop'}
      onAnimationEnd={onAnimationEnd}
      ref={backdropRef}
      onClick={handleBackdrop}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="modal-dialog cod-modal" role="dialog" aria-modal="true" aria-labelledby="codon-modal-title">
        <div className="modal-header">
          <h3 className="modal-title" id="codon-modal-title">Codon optimization</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body cod-body">
          {/* --- Settings --- */}
          <div className="cod-settings">
            <section className="cod-section">
              <h4 className="cod-heading">Target</h4>
              <div className="cod-radios">
                <label className="re-check">
                  <input
                    type="radio" name="cod-target" checked={settings.target === 'selection'}
                    disabled={!selectionRange}
                    onChange={() => patch({ target: 'selection' })}
                  />
                  Selection
                  <span className="cod-hint">
                    {selectionRange ? `${selectionRange.end - selectionRange.start} bp` : 'none'}
                  </span>
                </label>
                <label className="re-check">
                  <input
                    type="radio" name="cod-target" checked={settings.target === 'cds'}
                    disabled={features.length === 0}
                    onChange={() => patch({ target: 'cds' })}
                  />
                  Coding features
                  <span className="cod-hint">{features.length}</span>
                </label>
                <label className="re-check">
                  <input
                    type="radio" name="cod-target" checked={settings.target === 'whole'}
                    onChange={() => patch({ target: 'whole' })}
                  />
                  Whole sequence
                  <span className="cod-hint">{doc.sequence.length} bp</span>
                </label>
              </div>

              {settings.target === 'cds' && features.length > 0 && (
                <ul className="cod-feature-list">
                  {features.map(f => (
                    <li key={f.id}>
                      <label className="re-check">
                        <input
                          type="checkbox"
                          checked={featureIds.size === 0 || featureIds.has(f.id)}
                          onChange={() => setFeatureIds(prev => {
                            const all = new Set(features.map(x => x.id))
                            const next = prev.size === 0 ? all : new Set(prev)
                            if (next.has(f.id)) next.delete(f.id); else next.add(f.id)
                            return next.size === features.length ? new Set() : next
                          })}
                        />
                        <span className="cod-feature-name">{f.name || f.id}</span>
                        <span className="cod-hint">
                          {Math.abs(f.end - f.start)} bp {f.strand === -1 ? '(-)' : '(+)'}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="cod-section">
              <h4 className="cod-heading">Genetic code and usage</h4>
              <div className="re-field">
                <label className="re-field-label" htmlFor="cod-code">Genetic code</label>
                <select
                  id="cod-code" className="select"
                  value={settings.geneticCodeId}
                  onChange={e => patch({ geneticCodeId: Number(e.target.value) })}
                >
                  {GENETIC_CODES.map(c => (
                    <option key={c.id} value={c.id}>{c.id}. {c.name}</option>
                  ))}
                </select>
              </div>

              <div className="re-field">
                <label className="re-field-label" htmlFor="cod-table">Codon usage table</label>
                <div className="cod-row">
                  <select
                    id="cod-table" className="select"
                    value={settings.usageTableId}
                    onChange={e => patch({ usageTableId: e.target.value })}
                  >
                    <optgroup label="Built in">
                      {BUILTIN_USAGE_TABLES.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </optgroup>
                    {customTables.length > 0 && (
                      <optgroup label="Imported">
                        {customTables.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="From this document">
                      <option value={DERIVED_TABLE_ID} disabled={!derived}>
                        {derived
                          ? `This document's CDSs (${derived.codonsCounted} codons)`
                          : 'This document has no CDS features'}
                      </option>
                    </optgroup>
                  </select>
                  <button
                    className="btn btn-sm"
                    onClick={() => importRef.current?.click()}
                    title="Import a Kazusa, CSV or two-column codon usage table"
                  >
                    <Upload size={12} /> Import
                  </button>
                  {customTables.some(t => t.id === settings.usageTableId) && (
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        removeCustomUsageTable(settings.usageTableId)
                        patch({ usageTableId: DEFAULT_CODON_SETTINGS.usageTableId })
                      }}
                      title="Remove this imported table"
                      aria-label="Remove this imported table"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                  <input
                    ref={importRef} type="file" accept={IMPORT_ACCEPT} style={{ display: 'none' }}
                    onChange={e => { handleImport(e.target.files?.[0]); e.target.value = '' }}
                  />
                </div>
                {table && <div className="cod-source">{table.source}</div>}
                {table?.approximate && (
                  <div className="cod-source cod-warn">
                    Published averages, rounded. Import your own table or derive one from this
                    document if the exact figures matter.
                  </div>
                )}
                {tableMessage && (
                  <div className={`cod-source ${tableMessage.error ? 'cod-error' : ''}`} role="status">
                    {tableMessage.text}
                  </div>
                )}
              </div>
            </section>

            <section className="cod-section">
              <h4 className="cod-heading">What to change</h4>
              <div className="cod-radios">
                <label className="re-check">
                  <input
                    type="radio" name="cod-mode" checked={settings.mode === 'all'}
                    onChange={() => patch({ mode: 'all' })}
                  />
                  Every codon
                </label>
                <label className="re-check">
                  <input
                    type="radio" name="cod-mode" checked={settings.mode === 'rare-only'}
                    onChange={() => patch({ mode: 'rare-only' })}
                  />
                  Rare codons only
                </label>
              </div>

              {settings.mode === 'all' && (
                <div className="re-field">
                  <label className="re-field-label" htmlFor="cod-strategy">Codon choice</label>
                  <select
                    id="cod-strategy" className="select"
                    value={settings.strategy}
                    onChange={e => patch({ strategy: e.target.value as typeof settings.strategy })}
                  >
                    <option value="most-frequent">Most frequent codon</option>
                    <option value="usage-weighted">Sampled from the host distribution</option>
                  </select>
                </div>
              )}

              <div className="ann-similarity-row">
                <label htmlFor="cod-rare">Rare below</label>
                <input
                  id="cod-rare" type="range" className="ann-slider" min={1} max={30}
                  value={settings.rareThreshold}
                  onChange={e => patch({ rareThreshold: Number(e.target.value) })}
                />
                <span className="ann-sim-value">{settings.rareThreshold}%</span>
              </div>
            </section>

            <section className="cod-section">
              <h4 className="cod-heading">
                Avoid {motifCount > 0 && <span className="re-enzyme-count">{motifCount}</span>}
              </h4>

              <div className="cod-check-grid">
                {MOTIF_PRESETS.map(preset => (
                  <label className="re-check" key={preset.id} title={preset.description}>
                    <input
                      type="checkbox"
                      checked={settings.presetIds.includes(preset.id)}
                      onChange={() => patch({ presetIds: toggleIn(settings.presetIds, preset.id) })}
                    />
                    {preset.label}
                  </label>
                ))}
                <label className="re-check" title="Reduce CpG dinucleotides, e.g. for mammalian expression">
                  <input
                    type="checkbox" checked={settings.avoidCpG}
                    onChange={e => patch({ avoidCpG: e.target.checked })}
                  />
                  CpG dinucleotides
                </label>
              </div>

              <div className="re-field">
                <label className="re-field-label">Restriction sites</label>
                <div className="cod-check-grid">
                  {Object.keys(ENZYME_GROUPS).slice(0, 4).map(group => (
                    <label className="re-check" key={group}>
                      <input
                        type="checkbox"
                        checked={settings.enzymeGroups.includes(group)}
                        onChange={() => patch({ enzymeGroups: toggleIn(settings.enzymeGroups, group) })}
                      />
                      {group}
                    </label>
                  ))}
                </div>
                <input
                  className="input cod-input"
                  placeholder="Add single enzymes, e.g. EcoRI BamHI"
                  value={enzymeQuery}
                  onChange={e => setEnzymeQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key !== 'Enter') return
                    const names = enzymeQuery.split(/[\s,]+/).filter(Boolean)
                    patch({ enzymeNames: [...new Set([...settings.enzymeNames, ...names])] })
                    setEnzymeQuery('')
                  }}
                />
                {settings.enzymeNames.length > 0 && (
                  <div className="cod-chips">
                    {settings.enzymeNames.map(name => (
                      <button
                        key={name} className="cod-chip"
                        onClick={() => patch({ enzymeNames: settings.enzymeNames.filter(n => n !== name) })}
                        title={`Stop avoiding ${name}`}
                      >
                        {name} <X size={10} />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="re-field">
                <label className="re-field-label" htmlFor="cod-custom">Custom motifs</label>
                <textarea
                  id="cod-custom" className="input cod-textarea" rows={2}
                  placeholder="One per line, IUPAC allowed, e.g. GGTCTC or name=GGWWCC"
                  value={settings.customMotifs}
                  onChange={e => patch({ customMotifs: e.target.value })}
                />
              </div>
            </section>

            <section className="cod-section">
              <button className="cod-disclosure" onClick={() => setAdvancedOpen(v => !v)}>
                {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Advanced
              </button>
              {advancedOpen && (
                <div className="cod-advanced">
                  <div className="cod-num-grid">
                    <label>
                      Max A/T run
                      <input
                        type="number" className="re-num" min={0} max={30}
                        value={settings.maxHomopolymerAT}
                        onChange={e => patch({ maxHomopolymerAT: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Max G/C run
                      <input
                        type="number" className="re-num" min={0} max={30}
                        value={settings.maxHomopolymerGC}
                        onChange={e => patch({ maxHomopolymerGC: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Min GC %
                      <input
                        type="number" className="re-num" min={0} max={100}
                        value={settings.minGC}
                        onChange={e => patch({ minGC: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Max GC %
                      <input
                        type="number" className="re-num" min={0} max={100}
                        value={settings.maxGC}
                        onChange={e => patch({ maxGC: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      GC window
                      <input
                        type="number" className="re-num" min={0} max={500} step={10}
                        value={settings.gcWindow}
                        onChange={e => patch({ gcWindow: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Max repeat
                      <input
                        type="number" className="re-num" min={0} max={50}
                        value={settings.maxRepeat}
                        onChange={e => patch({ maxRepeat: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Max hairpin stem
                      <input
                        type="number" className="re-num" min={0} max={30}
                        value={settings.maxHairpinStem}
                        onChange={e => patch({ maxHairpinStem: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Keep first codons
                      <input
                        type="number" className="re-num" min={0} max={100}
                        value={settings.keepFirstCodons}
                        onChange={e => patch({ keepFirstCodons: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Seed
                      <input
                        type="number" className="re-num" min={1}
                        value={settings.seed}
                        onChange={e => patch({ seed: Number(e.target.value) || 1 })}
                      />
                    </label>
                  </div>
                  <label className="re-check">
                    <input
                      type="checkbox" checked={settings.keepStartCodon}
                      onChange={e => patch({ keepStartCodon: e.target.checked })}
                    />
                    Keep the start codon
                  </label>
                  <label className="re-check">
                    <input
                      type="checkbox" checked={settings.keepStopCodon}
                      onChange={e => patch({ keepStopCodon: e.target.checked })}
                    />
                    Keep the stop codon
                  </label>
                  <label className="re-check" title="Leave bases under other annotated features untouched">
                    <input
                      type="checkbox" checked={settings.protectFeatures}
                      onChange={e => patch({ protectFeatures: e.target.checked })}
                    />
                    Protect other annotated features
                  </label>
                  <button
                    className="btn btn-sm"
                    onClick={() => setSettings({ ...DEFAULT_CODON_SETTINGS })}
                  >
                    Reset to defaults
                  </button>
                </div>
              )}
            </section>
          </div>

          {/* --- Result --- */}
          <div className="cod-result">
            {!autoRun && manualRun === 0 && (
              <div className="cod-placeholder">
                <p>{targetSize.toLocaleString()} bp is a lot to optimize while you type.</p>
                <button className="btn btn-primary btn-sm" onClick={() => setManualRun(n => n + 1)}>
                  Run once
                </button>
              </div>
            )}

            {running && (
              <div className="cod-running"><Loader2 size={14} className="ann-spin" /> Working</div>
            )}

            {error && <div className="cod-error cod-block">{error}</div>}

            {result?.warnings.map((w, i) => (
              <div className="cod-warn cod-block" key={i}>{w}</div>
            ))}

            {result && result.regions.length > 0 && before && after && (
              <>
                <table className="cod-metrics">
                  <thead>
                    <tr><th></th><th>Before</th><th>After</th></tr>
                  </thead>
                  <tbody>
                    <MetricRow
                      label="CAI" before={before.cai} after={after.cai} higherIsBetter
                      format={v => formatMetric(v, 3)}
                    />
                    <MetricRow
                      label="GC" before={before.gc} after={after.gc}
                      format={v => formatMetric(v, 1, '%')}
                    />
                    <MetricRow
                      label="GC3" before={before.gc3} after={after.gc3}
                      format={v => formatMetric(v, 1, '%')}
                    />
                    <MetricRow
                      label="Rare codons" before={before.rareCodons} after={after.rareCodons}
                      higherIsBetter={false} format={v => formatMetric(v, 0)}
                    />
                    <MetricRow
                      label="Longest A/T run" before={before.longestRunAT} after={after.longestRunAT}
                      higherIsBetter={false} format={v => formatMetric(v, 0)}
                    />
                    <MetricRow
                      label="Longest G/C run" before={before.longestRunGC} after={after.longestRunGC}
                      higherIsBetter={false} format={v => formatMetric(v, 0)}
                    />
                  </tbody>
                </table>

                <div className="cod-summary">
                  {result.totalChanges} of {after.codons} codons changed
                  {result.regions.length > 1 && ` across ${result.regions.length} regions`}
                  {result.regions.some(r => r.lockedCodons > 0) &&
                    `, ${result.regions.reduce((n, r) => n + r.lockedCodons, 0)} left locked`}
                </div>

                {violationSummary.size > 0 ? (
                  <div className="cod-block cod-warn">
                    Could not satisfy everything:{' '}
                    {[...violationSummary.entries()].map(([kind, n]) => `${n} ${kind}`).join(', ')}
                    <ul className="cod-violations">
                      {result.regions.flatMap(r =>
                        r.violations.slice(0, 5).map((v, i) => (
                          <li key={`${r.id}-${i}`}>
                            {r.label} {v.start + 1}..{v.end}: {v.detail}
                          </li>
                        )),
                      ).slice(0, 8)}
                    </ul>
                  </div>
                ) : (
                  result.totalChanges > 0 && (
                    <div className="cod-block cod-ok">Every constraint satisfied</div>
                  )
                )}

                {result.regions.some(r => r.budgetExhausted) && (
                  <div className="cod-block cod-warn">
                    The search hit its step limit, so the result may not be the best available.
                    Loosening a constraint usually helps more than trying again.
                  </div>
                )}

                <div className="cod-changes">
                  {result.regions.map(region => (
                    <div key={region.id}>
                      {result.regions.length > 1 && (
                        <div className="cod-region-head">
                          {region.label}
                          <span className="cod-hint">{region.changes.length} changed</span>
                        </div>
                      )}
                      <ul className="cod-change-list">
                        {region.changes.slice(0, 200).map(change => (
                          <li key={change.index}>
                            <span className="cod-pos">{change.index + 1}</span>
                            <span className="cod-aa">{change.aa}</span>
                            <span className="cod-codon">{change.from}</span>
                            <span className="cod-arrow">to</span>
                            <span className="cod-codon cod-new">{change.to}</span>
                          </li>
                        ))}
                        {region.changes.length > 200 && (
                          <li className="cod-hint">
                            and {region.changes.length - 200} more
                          </li>
                        )}
                      </ul>
                    </div>
                  ))}
                </div>
              </>
            )}

            {result && result.regions.length > 0 && result.totalChanges === 0 && (
              <div className="cod-block cod-ok">Nothing to change with these settings</div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <span className="cod-footer-note">
            {readOnly ? 'This document is read-only' : 'Applying replaces the bases in place, as one undo step'}
          </span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn"
            onClick={handleOpenCopy}
            disabled={!result || result.totalChanges === 0}
          >
            Open as new sequence
          </button>
          <button
            className="btn btn-primary"
            onClick={handleApply}
            disabled={!result || result.totalChanges === 0 || readOnly}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
