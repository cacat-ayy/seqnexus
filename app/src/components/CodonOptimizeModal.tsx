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
import { X, Loader2, ChevronDown, ChevronRight, Upload, Trash2, Search } from 'lucide-react'
import { useEditorStore } from '../store'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'
import { getEnzyme } from '../enzymes/db'
import { GENETIC_CODES, geneticCode } from '../codon/genetic-codes'
import {
  BUILTIN_USAGE_TABLES, type CodonUsageTable,
} from '../codon/usage-tables'
import { parseUsageTable, describeUsageImport, UsageImportError } from '../codon/usage-import'
import {
  MOTIF_PRESETS, ENZYME_GROUP_OPTIONS, enzymeNamesInGroup,
} from '../codon/constraints'
import { codingFeatures } from '../codon/targets'
import {
  constraintSetFor, motifsFor, targetOptionsFor, selectedEnzymeNames,
  DEFAULT_CODON_SETTINGS,
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
/** What cusp and CodonFrequency actually write, plus the .txt people rename them to. */
const IMPORT_ACCEPT = '.cusp,.cod,.txt'

function formatMetric(value: number | null, digits = 1, suffix = ''): string {
  if (value === null || Number.isNaN(value)) return '-'
  return value.toFixed(digits) + suffix
}

/** One before/after row of the summary table. */
function MetricRow(
  { label, tip, before, after, format, higherIsBetter }: {
    label: string
    /** What the number means. These are not self-explanatory to everyone. */
    tip: string
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
    <tr title={tip}>
      <td><span className="cod-metric-label">{label}</span></td>
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
  // Regions start collapsed and each one is opened on demand, so a run over a
  // plasmid's worth of CDSs does not open as hundreds of codon rows.
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set())
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

  /** Enzymes of the chosen category, and the subset the filter box shows. */
  const groupEnzymes = useMemo(
    () => settings.enzymeGroup ? enzymeNamesInGroup(settings.enzymeGroup) : [],
    [settings.enzymeGroup],
  )
  const visibleEnzymes = useMemo(() => {
    const q = enzymeQuery.trim().toLowerCase()
    if (!q) return groupEnzymes
    return groupEnzymes.filter(name =>
      name.toLowerCase().includes(q) ||
      (getEnzyme(name)?.recognition ?? '').toLowerCase().includes(q))
  }, [groupEnzymes, enzymeQuery])

  const table: CodonUsageTable | null = useMemo(() =>
    BUILTIN_USAGE_TABLES.find(t => t.id === settings.usageTableId)
      ?? customTables.find(t => t.id === settings.usageTableId)
      ?? null,
  [settings.usageTableId, customTables])

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
      metadata: { ...doc.metadata, origin: 'optimized' },
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
                    type="radio" name="cod-target" checked={settings.target === 'whole'}
                    onChange={() => patch({ target: 'whole' })}
                  />
                  Whole sequence
                  <span className="cod-hint">{doc.sequence.length} bp</span>
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
                  </select>
                  <button
                    className="btn btn-sm"
                    onClick={() => importRef.current?.click()}
                    title="Import an EMBOSS cusp (.cusp) or GCG CodonFrequency (.cod) table"
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
                    Published averages, rounded. Import an EMBOSS cusp (.cusp) or GCG
                    CodonFrequency (.cod) table if the exact figures matter.
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

              <div className="ann-similarity-row">
                <label htmlFor="cod-rare">Rare below</label>
                <input
                  id="cod-rare" type="range" className="ann-slider" min={1} max={30}
                  value={settings.rareThreshold}
                  onChange={e => patch({ rareThreshold: Number(e.target.value) })}
                />
                <span className="ann-sim-value">{settings.rareThreshold}%</span>
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

              {/* Pick a category, then untick what you do not care about.
                  Every enzyme in the category starts ticked, because choosing
                  a category is already the statement "keep these out". */}
              <div className="re-field">
                <label className="re-field-label" htmlFor="cod-enzyme-group">Restriction sites</label>
                <select
                  id="cod-enzyme-group" className="select"
                  value={settings.enzymeGroup}
                  onChange={e => patch({ enzymeGroup: e.target.value, enzymeExcluded: [] })}
                >
                  <option value="">None</option>
                  {ENZYME_GROUP_OPTIONS.map(group => (
                    <option key={group} value={group}>
                      {group} ({enzymeNamesInGroup(group).length})
                    </option>
                  ))}
                </select>

                {settings.enzymeGroup && (
                  <>
                    <div className="cod-enzyme-bar">
                      <div className="ann-search-box cod-enzyme-search">
                        <Search size={13} />
                        <input
                          className="ann-search-input"
                          placeholder="Filter enzymes"
                          value={enzymeQuery}
                          onChange={e => setEnzymeQuery(e.target.value)}
                        />
                      </div>
                      <span className="cod-hint">
                        {selectedEnzymeNames(settings).length} of {groupEnzymes.length}
                      </span>
                    </div>
                    <div className="cod-enzyme-actions">
                      <button
                        className="cod-linkish"
                        onClick={() => patch({ enzymeExcluded: [] })}
                        disabled={settings.enzymeExcluded.length === 0}
                      >
                        Select all
                      </button>
                      <button
                        className="cod-linkish"
                        onClick={() => patch({ enzymeExcluded: [...groupEnzymes] })}
                        disabled={settings.enzymeExcluded.length === groupEnzymes.length}
                      >
                        Clear
                      </button>
                    </div>
                    <ul className="cod-enzyme-list">
                      {visibleEnzymes.map(name => (
                        <li key={name}>
                          <label className="re-check">
                            <input
                              type="checkbox"
                              checked={!settings.enzymeExcluded.includes(name)}
                              onChange={() => patch({
                                enzymeExcluded: toggleIn(settings.enzymeExcluded, name),
                              })}
                            />
                            <span className="cod-enzyme-name">{name}</span>
                            <span className="cod-enzyme-site">{getEnzyme(name)?.recognition}</span>
                          </label>
                        </li>
                      ))}
                      {visibleEnzymes.length === 0 && (
                        <li className="cod-hint">No enzyme matches "{enzymeQuery}"</li>
                      )}
                    </ul>
                  </>
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
                    <label title="Longest run of a single A or T the optimizer may leave behind. Runs longer than this cause polymerase slippage and synthesis failures. 0 turns the check off.">
                      Max A/T run
                      <input
                        type="number" className="re-num" min={0} max={30}
                        value={settings.maxHomopolymerAT}
                        onChange={e => patch({ maxHomopolymerAT: Number(e.target.value) })}
                      />
                    </label>
                    <label title="Longest run of a single G or C. Usually set shorter than the A/T limit. 0 turns the check off. Some runs cannot be avoided: tryptophan is only TGG, and every valine and glycine codon starts with G.">
                      Max G/C run
                      <input
                        type="number" className="re-num" min={0} max={30}
                        value={settings.maxHomopolymerGC}
                        onChange={e => patch({ maxHomopolymerGC: Number(e.target.value) })}
                      />
                    </label>
                    <label title="Lowest GC content accepted for the region, and for each sliding window when a window size is set. 0 turns the lower bound off.">
                      Min GC %
                      <input
                        type="number" className="re-num" min={0} max={100}
                        value={settings.minGC}
                        onChange={e => patch({ minGC: Number(e.target.value) })}
                      />
                    </label>
                    <label title="Highest GC content accepted for the region, and for each sliding window when a window size is set. 100 turns the upper bound off.">
                      Max GC %
                      <input
                        type="number" className="re-num" min={0} max={100}
                        value={settings.maxGC}
                        onChange={e => patch({ maxGC: Number(e.target.value) })}
                      />
                    </label>
                    <label title="Width in bases of the window slid along the region and checked against the GC bounds. It catches a GC-rich stretch that an acceptable average would hide. 0 checks only the region as a whole.">
                      GC window
                      <input
                        type="number" className="re-num" min={0} max={500} step={10}
                        value={settings.gcWindow}
                        onChange={e => patch({ gcWindow: Number(e.target.value) })}
                      />
                    </label>
                    <label title="Longest exact direct repeat allowed anywhere in the region. Repeats confuse gene synthesis and assembly. 0 turns the check off.">
                      Max repeat
                      <input
                        type="number" className="re-num" min={0} max={50}
                        value={settings.maxRepeat}
                        onChange={e => patch({ maxRepeat: Number(e.target.value) })}
                      />
                    </label>
                    <label title="Longest inverted repeat allowed, used as a cheap stand-in for secondary structure. Only arms within 30 bases of each other count as a hairpin. 0 turns the check off.">
                      Max hairpin stem
                      <input
                        type="number" className="re-num" min={0} max={30}
                        value={settings.maxHairpinStem}
                        onChange={e => patch({ maxHairpinStem: Number(e.target.value) })}
                      />
                    </label>
                    <label title="Leave this many codons at the 5' end exactly as they are, for a translation ramp, a tag, or a cloning junction you do not want touched.">
                      Keep first codons
                      <input
                        type="number" className="re-num" min={0} max={100}
                        value={settings.keepFirstCodons}
                        onChange={e => patch({ keepFirstCodons: Number(e.target.value) })}
                      />
                    </label>
                    <label title="Seeds the sampled codon choice, so the same settings always produce the same sequence. Only used by the sampled strategy.">
                      Seed
                      <input
                        type="number" className="re-num" min={1}
                        value={settings.seed}
                        onChange={e => patch({ seed: Number(e.target.value) || 1 })}
                      />
                    </label>
                  </div>
                  <label
                    className="re-check"
                    title="Leave the initiator codon exactly as it is. Switching this off lets the optimizer swap it for another codon of the same amino acid, which is rarely what you want."
                  >
                    <input
                      type="checkbox" checked={settings.keepStartCodon}
                      onChange={e => patch({ keepStartCodon: e.target.checked })}
                    />
                    Keep the start codon
                  </label>
                  <label
                    className="re-check"
                    title="Leave a terminal stop codon as it is. Switching this off lets the optimizer pick the host's preferred stop instead."
                  >
                    <input
                      type="checkbox" checked={settings.keepStopCodon}
                      onChange={e => patch({ keepStopCodon: e.target.checked })}
                    />
                    Keep the stop codon
                  </label>
                  <label
                    className="re-check"
                    title="Do not rewrite bases that sit under another annotated feature, such as a ribosome binding site, a primer site or a tag. Those codons are listed as locked in the run."
                  >
                    <input
                      type="checkbox" checked={settings.protectFeatures}
                      onChange={e => patch({ protectFeatures: e.target.checked })}
                    />
                    Protect other annotated features
                  </label>
                  <button
                    className="btn btn-sm"
                    onClick={() => setSettings({ ...DEFAULT_CODON_SETTINGS })}
                    title="Put every setting in this dialog back to its default, including the target and the usage table."
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
                      tip={'Codon Adaptation Index, 0 to 1. The geometric mean of how each codon '
                        + 'rates against the best codon for its amino acid in the chosen host. '
                        + '1.0 would be the host favourite everywhere. Methionine and tryptophan '
                        + 'are left out: with one codon each they say nothing about adaptation.'}
                    />
                    <MetricRow
                      label="GC" before={before.gc} after={after.gc}
                      format={v => formatMetric(v, 1, '%')}
                      tip={'G and C as a percentage of the optimized region. Synthesis vendors '
                        + 'usually want this between about 30 and 70 percent.'}
                    />
                    <MetricRow
                      label="GC3" before={before.gc3} after={after.gc3}
                      format={v => formatMetric(v, 1, '%')}
                      tip={'GC at the third base of each codon, which is the position synonymous '
                        + 'choice mostly moves. It tracks the host bias more closely than overall GC.'}
                    />
                    <MetricRow
                      label="Rare codons" before={before.rareCodons} after={after.rareCodons}
                      higherIsBetter={false} format={v => formatMetric(v, 0)}
                      tip={`Codons used less than ${settings.rareThreshold}% of the time within `
                        + 'their amino acid family in this host. Families with a single codon '
                        + 'never count as rare.'}
                    />
                    <MetricRow
                      label="Longest A/T run" before={before.longestRunAT} after={after.longestRunAT}
                      higherIsBetter={false} format={v => formatMetric(v, 0)}
                      tip={'Longest run of a single A or T. Long runs cause polymerase slippage '
                        + 'and are a common reason a synthesis order is rejected. AATT is not a '
                        + 'run of four: only the same base repeated counts.'}
                    />
                    <MetricRow
                      label="Longest G/C run" before={before.longestRunGC} after={after.longestRunGC}
                      higherIsBetter={false} format={v => formatMetric(v, 0)}
                      tip={'Longest run of a single G or C. Same problem as an A/T run, and '
                        + 'usually tolerated at a shorter length.'}
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

                {/* One collapsed row per region. The codon list is long and
                    rarely the thing being read: the counts are. */}
                <div className="cod-changes">
                  {result.regions.map(region => {
                    const open = expandedRegions.has(region.id)
                    return (
                      <div key={region.id}>
                        <button
                          className="cod-region-head"
                          onClick={() => setExpandedRegions(prev => {
                            const next = new Set(prev)
                            if (next.has(region.id)) next.delete(region.id)
                            else next.add(region.id)
                            return next
                          })}
                          aria-expanded={open}
                          title={`${region.changes.length} of ${region.after.codons} codons changed, ${region.identity.toFixed(1)}% identical to the original`}
                        >
                          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          <span className="cod-region-name">{region.label}</span>
                          <span className="cod-hint">
                            {region.changes.length} change{region.changes.length === 1 ? '' : 's'}
                          </span>
                        </button>
                        {open && (
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
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {result && result.regions.length > 0 && result.totalChanges === 0 && (
              <div className="cod-block cod-ok">Nothing to change with these settings</div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn"
            onClick={handleApply}
            disabled={!result || result.totalChanges === 0 || readOnly}
            // The note that used to sit in the footer said this; on the button
            // it is where the decision is made, and it still explains itself
            // when the document is locked.
            title={readOnly
              ? 'This document is read-only'
              : 'Replaces the bases in place, as one undo step'}
          >
            Apply to sequence
          </button>
          {/* The primary action: it cannot lose anything, where applying
              rewrites the document the user is looking at. */}
          <button
            className="btn btn-primary"
            onClick={handleOpenCopy}
            disabled={!result || result.totalChanges === 0}
            title="Open the result as a new sequence and leave this one untouched"
          >
            Open as new sequence
          </button>
        </div>
      </div>
    </div>
  )
}
