import './finder.css'
/**
 * The ORFs tab: the panel's finder slot on DNA.
 *
 * The settings are the whole scan (minimum size, start codons, the bases
 * searched, every start, nested and partial ORFs), so there is no Run
 * button: useOrfScan reruns it whenever one changes. Below them a table of
 * every ORF, longest first, and the one in focus with its protein and what
 * can be done with it. Export saves the picked ORFs, or all of them.
 *
 * A selection to search is taken when asked, not followed: clicking a row
 * selects that ORF, which would otherwise narrow the search to it.
 *
 * Clicking a row selects the ORF's bases, and the view, which this tab does
 * not cover, scrolls to it. The box at the start of a row picks it for Add;
 * Ctrl-click does the same, as on the canvas.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Atom, Copy, Download, FileSpreadsheet, FileText, Globe, Plus } from 'lucide-react'
import { useEditorStore } from '../../store'
import { Annotation } from '../../models/Annotation'
import { displayPosition } from '../../models/Document'
import { selectionAsRange } from '../../models/selection'
import { geneticCode } from '../../codon/genetic-codes'
import { orfAminoAcids, type ORFResult } from '../../orfs/finder'
import { orfProtein, orfLengthBp, orfsCsv, orfsFasta } from '../../orfs/export'
import { orfColor } from '../../workers/orf-finder'
import { orfKey, convertibleOrfs, orfOverlayData, orfCodons, isOrfAnnotated, orfFrameLabel as frameLabel } from '../../utils/orf-features'
import { selectFeature, blastFeatureProtein } from '../features/feature-actions'
import { copyText } from '../../utils/clipboard'
import { saveText } from '../../utils/download'
import { formatBp } from '../../utils/format'
import { proteinMass, formatMass } from '../../protein/properties'
import ConfirmDialog from '../ConfirmDialog'
import ContextMenuPopup, { MenuItem } from '../ContextMenuPopup'

/** Quick sizes, in residues: NCBI ORFfinder's 75, 150, 300 and 600 nt. */
const SIZE_PRESETS = [25, 50, 100, 200]
const START_CODONS = ['ATG', 'GTG', 'TTG', 'CTG']
/** The wait after the last keystroke in the size box before it is used. */
const SIZE_DELAY_MS = 400
/** Rows drawn at once; the rest are a sort or a larger minimum away. */
const ROW_CAP = 500
/** What an ORF that already has its CDS says, on its row and in the count. */
const ADDED_TITLE = 'Already a CDS feature: Add leaves it out'
/** Past this many, adding every ORF asks first. */
const CONFIRM_ADD_ALL = 50

type SortKey = 'length' | 'position' | 'frame'
interface Sort { key: SortKey; desc: boolean }

/** Frames in reading order: +1, +2, +3, then −1, −2, −3. */
const frameRank = (o: ORFResult) => (o.strand === 1 ? 0 : 3) + o.frame

const COMPARE: Record<SortKey, (a: ORFResult, b: ORFResult) => number> = {
  length: (a, b) => orfAminoAcids(a) - orfAminoAcids(b),
  position: (a, b) => a.start - b.start,
  frame: (a, b) => frameRank(a) - frameRank(b) || a.start - b.start,
}

const n = (x: number) => x.toLocaleString('en-US')

export default function OrfTab() {
  const doc = useEditorStore(s => s.doc)
  const orfs = useEditorStore(s => s.orfResults)
  const scanning = useEditorStore(s => s.orfScanning)
  const picks = useEditorStore(s => s.orfPicks)
  const togglePick = useEditorStore(s => s.toggleOrfPick)
  const applyOrfs = useEditorStore(s => s.applyOrfs)
  const showOrfs = useEditorStore(s => s.showOrfs)
  const toggleOrfs = useEditorStore(s => s.toggleOrfs)
  const setOrfParams = useEditorStore(s => s.setOrfParams)
  const minAminoAcids = useEditorStore(s => s.orfMinAminoAcids)
  const startCodons = useEditorStore(s => s.orfStartCodons)
  const allowInterior = useEditorStore(s => s.orfAllowInterior)
  const includePartial = useEditorStore(s => s.orfIncludePartial)
  const startsFromCode = useEditorStore(s => s.orfStartsFromCode)
  const allStarts = useEditorStore(s => s.orfAllStarts)
  const codeId = useEditorStore(s => s.translationCodeId)
  const readOnly = useEditorStore(s => s.readOnly)

  const sequence = doc.sequence
  const seqLen = sequence.length
  const circular = sequence.topology === 'circular'
  const origin = doc.metadata?.displayOrigin ?? 0
  const at = useCallback((i: number) => n(displayPosition(i, origin, seqLen)), [origin, seqLen])

  // --- The minimum size, as typed: used once it is a whole number and typing pauses ---
  const [sizeText, setSizeText] = useState(String(minAminoAcids))
  const sizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { setSizeText(String(minAminoAcids)) }, [minAminoAcids])
  useEffect(() => () => { if (sizeTimer.current) clearTimeout(sizeTimer.current) }, [])
  const commitSize = useCallback((text: string) => {
    if (sizeTimer.current) { clearTimeout(sizeTimer.current); sizeTimer.current = null }
    const v = Number(text)
    if (text.trim() !== '' && Number.isInteger(v) && v >= 1) setOrfParams({ orfMinAminoAcids: v })
    else setSizeText(String(useEditorStore.getState().orfMinAminoAcids))
  }, [setOrfParams])
  const typeSize = useCallback((text: string) => {
    setSizeText(text)
    if (sizeTimer.current) clearTimeout(sizeTimer.current)
    const v = Number(text)
    if (text.trim() !== '' && Number.isInteger(v) && v >= 1) {
      sizeTimer.current = setTimeout(() => commitSize(text), SIZE_DELAY_MS)
    }
  }, [commitSize])

  // --- Start codons: the code's own, or chosen from the usual four and the code's ---
  const code = geneticCode(codeId)
  const startChoices = useMemo(
    () => [...new Set([...START_CODONS, ...code.starts, ...startCodons])],
    [code, startCodons],
  )

  // --- The bases searched: all of them, or a selection taken when asked ---
  const selection = useEditorStore(s => s.selection)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const orfRange = useEditorStore(s => s.orfRange)
  const setOrfRange = useEditorStore(s => s.setOrfRange)
  const range = orfRange && orfRange.tabId === activeTabId && seqLen > 0
    ? { start: Math.min(orfRange.start, seqLen), end: Math.min(orfRange.end, seqLen) }
    : null
  const rangeLength = range ? (range.end > range.start ? range.end - range.start : seqLen - range.start + range.end) : 0
  const selected = useMemo(() => selectionAsRange(selection, sequence.topology), [selection, sequence.topology])
  const sameAsRange = !!range && !!selected && range.start === selected.start && range.end === selected.end
  const takeSelection = useCallback(() => {
    if (selected && activeTabId) setOrfRange({ tabId: activeTabId, ...selected })
  }, [selected, activeTabId, setOrfRange])
  // Partial ORFs need ends: a circle has none, unless a selection of it is searched.
  const noEnds = circular && !range

  const toggleStart = useCallback((codon: string, on: boolean) => {
    const prev = useEditorStore.getState().orfStartCodons
    const next = on ? [...prev, codon] : prev.filter(c => c !== codon)
    // At least one: a scan with no start codon finds nothing.
    if (next.length > 0) setOrfParams({ orfStartCodons: next })
  }, [setOrfParams])

  // --- The table ---
  const [sort, setSort] = useState<Sort>({ key: 'length', desc: true })
  const sorted = useMemo(() => {
    const cmp = COMPARE[sort.key]
    return [...orfs].sort((a, b) => (sort.desc ? -1 : 1) * cmp(a, b) || a.start - b.start)
  }, [orfs, sort])
  const shown = sorted.length > ROW_CAP ? sorted.slice(0, ROW_CAP) : sorted
  const sortBy = (key: SortKey) => setSort(s => s.key === key ? { key, desc: !s.desc } : { key, desc: key === 'length' })

  const convertible = useMemo(() => convertibleOrfs(orfs, doc.annotations), [orfs, doc.annotations])
  const convertibleKeys = useMemo(() => new Set(convertible.map(orfKey)), [convertible])
  const addedCount = orfs.length - convertible.length
  const pickedCount = useMemo(
    () => convertible.reduce((c, o) => c + (picks.has(orfKey(o)) ? 1 : 0), 0),
    [convertible, picks],
  )
  const [confirmAddAll, setConfirmAddAll] = useState(false)

  // --- Export: the picked ORFs, or every one, in the table's order ---
  const [exportAt, setExportAt] = useState<{ x: number; y: number } | null>(null)
  const pickedAll = useMemo(() => sorted.filter(o => picks.has(orfKey(o))), [sorted, picks])
  const exportAs = (kind: 'protein' | 'bases' | 'csv') => {
    setExportAt(null)
    const list = pickedAll.length > 0 ? pickedAll : sorted
    const src = { name: doc.name || 'sequence', sequence, geneticCodeId: codeId, origin }
    const stem = src.name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')
    if (kind === 'csv') saveText(orfsCsv(list, src), `${stem}_orfs.csv`, 'text/csv')
    else saveText(orfsFasta(list, src, kind), `${stem}_orfs_${kind === 'protein' ? 'protein' : 'cds'}.fasta`)
  }

  // --- The ORF in focus ---
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const active = useMemo(() => orfs.find(o => orfKey(o) === activeKey) ?? null, [orfs, activeKey])
  const listRef = useRef<HTMLUListElement>(null)

  const focusOrf = useCallback((orf: ORFResult) => {
    setActiveKey(orfKey(orf))
    selectFeature({ start: orf.start, end: orf.end })
  }, [])

  const handleRow = useCallback((orf: ORFResult, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) { togglePick(orfKey(orf)); return }
    focusOrf(orf)
  }, [focusOrf, togglePick])

  const handleListKey = useCallback((e: React.KeyboardEvent) => {
    if (shown.length === 0) return
    const i = shown.findIndex(o => orfKey(o) === activeKey)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = e.key === 'ArrowDown' ? Math.min(shown.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1)
      focusOrf(shown[next])
      document.getElementById(rowId(orfKey(shown[next])))?.scrollIntoView?.({ block: 'nearest' })
    } else if (e.key === ' ' && i >= 0) {
      e.preventDefault()
      togglePick(orfKey(shown[i]))
    }
  }, [shown, activeKey, focusOrf, togglePick])

  if (sequence.isProtein) {
    return <div className="fd-empty">A protein has no reading frames to search. Its Motifs tab finds sites in it.</div>
  }

  return (
    <div className="fd">
      <div className="fd-setup">
        <div className="fd-settings">
          <div className="fd-field">
            <label className="fd-field-label" htmlFor="fd-orf-size">Minimum size</label>
            <div className="fd-size">
              <input
                id="fd-orf-size"
                type="number"
                min={1}
                className="input fd-size-input"
                value={sizeText}
                onChange={e => typeSize(e.target.value)}
                onBlur={e => commitSize(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitSize(e.currentTarget.value) }}
              />
              <span className="fd-size-unit">aa</span>
              <div className="seg seg-sm" role="group" aria-label="Minimum size presets">
                {SIZE_PRESETS.map(p => (
                  <button
                    key={p}
                    type="button"
                    className={minAminoAcids === p ? 'active' : ''}
                    aria-pressed={minAminoAcids === p}
                    onClick={() => setOrfParams({ orfMinAminoAcids: p })}
                    title={`${p} residues, ${n(p * 3)} bases before the stop`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <span className="fd-hint">Residues, the stop not counted: {n(minAminoAcids * 3)} bp and up.</span>
          </div>

          <div className="fd-field">
            <span className="fd-field-label" id="fd-orf-starts">Start codons</span>
            <div className="seg seg-sm" role="group" aria-labelledby="fd-orf-starts">
              <button
                type="button"
                className={startsFromCode ? 'active' : ''}
                aria-pressed={startsFromCode}
                onClick={() => setOrfParams({ orfStartsFromCode: true })}
                title={`The initiation codons of the genetic code in use (${code.name})`}
              >
                From the genetic code
              </button>
              <button
                type="button"
                className={!startsFromCode ? 'active' : ''}
                aria-pressed={!startsFromCode}
                onClick={() => setOrfParams({ orfStartsFromCode: false })}
                title="The start codons ticked below"
              >
                Chosen
              </button>
            </div>
            {startsFromCode ? (
              <span className="fd-hint">
                {code.name}: <span className="fd-codons">{code.starts.join(', ')}</span>
              </span>
            ) : (
              <div className="fd-checks">
                {startChoices.map(codon => (
                  <label key={codon} className="fd-check fd-codon">
                    <input
                      type="checkbox"
                      checked={startCodons.includes(codon)}
                      onChange={e => toggleStart(codon, e.target.checked)}
                    />
                    {codon}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="fd-field">
            <span className="fd-field-label" id="fd-orf-scope">Search in</span>
            <div className="seg seg-sm" role="group" aria-labelledby="fd-orf-scope">
              <button
                type="button"
                className={!range ? 'active' : ''}
                aria-pressed={!range}
                onClick={() => setOrfRange(null)}
              >
                Whole sequence
              </button>
              <button
                type="button"
                className={range ? 'active' : ''}
                aria-pressed={!!range}
                disabled={!range && !selected}
                onClick={takeSelection}
                title={range || selected ? 'Only the selected bases, read as a fragment of their own' : 'Select bases first'}
              >
                Selection
              </button>
            </div>
            {range && (
              <span className="fd-hint fd-range">
                <span>{at(range.start)}..{at((range.end - 1 + seqLen) % seqLen)}, {formatBp(rangeLength)}</span>
                {selected && !sameAsRange && (
                  <button type="button" className="fd-link" onClick={takeSelection} title="Search the bases selected now instead">
                    Use the selection now
                  </button>
                )}
              </span>
            )}
          </div>

          <div className="fd-checks">
            <label
              className="fd-check"
              title="Hides an ORF that lies entirely inside a longer one, in any frame and on either strand. Within a frame, only the longest ORF to each stop codon is ever listed."
            >
              <input type="checkbox" checked={!allowInterior} onChange={e => setOrfParams({ orfAllowInterior: !e.target.checked })} />
              Hide nested ORFs
            </label>
            <label
              className="fd-check"
              title="Lists an ORF from every start codon, each to the same stop as the longest: a gene's alternative initiation sites. Off, only the longest ORF to each stop."
            >
              <input type="checkbox" checked={allStarts} onChange={e => setOrfParams({ orfAllStarts: e.target.checked })} />
              Every start codon
            </label>
            <label
              className={`fd-check ${noEnds ? 'is-disabled' : ''}`}
              title={noEnds
                ? 'A circular sequence has no ends to cut an ORF off. Search a selection to use the ends of that.'
                : `Also lists ORFs cut off by the ends of the ${range ? 'selection searched' : 'sequence'}: open from the first whole codon to a stop, or from a start codon to the end. For fragments, contigs and PCR products.`}
            >
              <input
                type="checkbox"
                checked={includePartial && !noEnds}
                disabled={noEnds}
                onChange={e => setOrfParams({ orfIncludePartial: e.target.checked })}
              />
              Include partial ORFs
            </label>
            <label className="fd-check">
              <input type="checkbox" checked={showOrfs} onChange={() => toggleOrfs()} />
              Show on the sequence
            </label>
          </div>
        </div>
      </div>

      <div className="fd-main">
        <div className="fd-status">
          <span className="fd-status-count" aria-live="polite">
            <span>{scanning && orfs.length === 0 ? 'Scanning…' : `${n(orfs.length)} ORF${orfs.length === 1 ? '' : 's'}`}</span>
            {addedCount > 0 && !scanning && <span className="fd-added" title={ADDED_TITLE}>{n(addedCount)} already CDS</span>}
            {pickedCount > 0 && <span className="fd-picked">{pickedCount} picked</span>}
          </span>
          <span className="fd-status-actions">
          {orfs.length > 0 && (
            <button
              className="btn btn-sm"
              aria-haspopup="menu"
              aria-expanded={!!exportAt}
              onClick={e => {
                const r = e.currentTarget.getBoundingClientRect()
                setExportAt(exportAt ? null : { x: r.left, y: r.bottom + 4 })
              }}
              title={pickedAll.length > 0 ? `Save the ${pickedAll.length} picked ORFs` : 'Save every ORF in the table'}
            >
              <Download size={12} aria-hidden /> Export
            </button>
          )}
          {convertible.length > 0 && !readOnly && (
            <button
              className={`btn btn-sm ${pickedCount > 0 ? 'btn-primary' : ''}`}
              onClick={() => {
                if (pickedCount > 0) applyOrfs(picks)
                else if (convertible.length > CONFIRM_ADD_ALL) setConfirmAddAll(true)
                else applyOrfs()
              }}
              title={addedCount > 0
                ? `Add the ORFs that are not CDS features yet (${n(addedCount)} already are)`
                : 'Add these ORFs to the document as CDS features'}
            >
              {pickedCount > 0 ? `Add picked (${pickedCount})` : `Add all (${n(convertible.length)})`}
            </button>
          )}
          </span>
        </div>

        <div className="fd-table fd-orfs">
          {orfs.length > 0 && (
            <div className="fd-head">
              <span />
              <SortHeader label="Frame" id="frame" sort={sort} onSort={sortBy} />
              <SortHeader label="Location" id="position" sort={sort} onSort={sortBy} />
              <SortHeader label="Length" id="length" sort={sort} onSort={sortBy} num />
              <span className="fd-th fd-col-wide">Start</span>
            </div>
          )}
          <ul
            ref={listRef}
            className="fd-list"
            role="listbox"
            aria-label="ORFs"
            tabIndex={shown.length > 0 ? 0 : -1}
            aria-activedescendant={active ? rowId(orfKey(active)) : undefined}
            onKeyDown={handleListKey}
          >
            {shown.map(orf => {
              const key = orfKey(orf)
              const codons = orfCodons(orf, sequence)
              const partial = orf.partialStart || orf.partialEnd
              // Already a CDS: listed, since it is still a reading frame, but
              // not offered for Add, which would leave it out.
              const added = !convertibleKeys.has(key)
              const picked = !added && picks.has(key)
              return (
                <li
                  key={key}
                  id={rowId(key)}
                  role="option"
                  aria-selected={key === activeKey}
                  className={`fd-row ${key === activeKey ? 'active' : ''} ${picked ? 'picked' : ''} ${added ? 'is-added' : ''}`}
                  title={added ? ADDED_TITLE : undefined}
                  onClick={e => handleRow(orf, e)}
                >
                  <input
                    type="checkbox"
                    className="fd-pick"
                    tabIndex={-1}
                    aria-label={added ? `ORF ${frameLabel(orf)} at ${at(orf.start)} is already a CDS feature` : `Pick ORF ${frameLabel(orf)} at ${at(orf.start)} for Add`}
                    checked={picked}
                    disabled={added}
                    onClick={e => e.stopPropagation()}
                    onChange={() => togglePick(key)}
                  />
                  <span className="fd-name">
                    <span className="fd-swatch" style={{ backgroundColor: orfColor(orf.strand, orf.frame) }} />
                    <span>{frameLabel(orf)}</span>
                  </span>
                  <span className="fd-cell tabular" title={`${at(orf.start)}..${at(orf.end - 1)}`}>{at(orf.start)}..{at(orf.end - 1)}</span>
                  <span className="fd-cell num">
                    {n(orfAminoAcids(orf))} aa
                    {partial && <span className="fd-chip" title={partialText(orf)}>partial</span>}
                  </span>
                  <span className={`fd-cell mono fd-col-wide ${codons.start ? '' : 'muted'}`}>{codons.start ?? 'none'}</span>
                </li>
              )
            })}
            {sorted.length > shown.length && (
              <li className="fd-more">
                Showing the first {n(shown.length)} of {n(sorted.length)}. Raise the minimum size to see fewer.
              </li>
            )}
            {orfs.length === 0 && !scanning && (
              <li className="fd-empty">
                {seqLen === 0
                  ? 'Open a sequence to find ORFs in it.'
                  : `No ORF this long${range ? ' in the selection searched' : ''}. Lower the minimum size or allow more start codons.`}
              </li>
            )}
          </ul>
        </div>
      </div>

      <div className="fd-side">
        {active && (
          <OrfInspector
            key={orfKey(active)}
            orf={active}
            codeId={codeId}
            at={at}
            readOnly={readOnly}
            onAdd={() => applyOrfs([orfKey(active)])}
          />
        )}
      </div>

      {exportAt && (
        <ContextMenuPopup x={exportAt.x} y={exportAt.y} onClose={() => setExportAt(null)} label="Export the ORFs">
          <MenuItem icon={<FileText size={13} />} onSelect={() => exportAs('protein')}>
            Proteins (FASTA)
          </MenuItem>
          <MenuItem icon={<FileText size={13} />} onSelect={() => exportAs('bases')}>
            Coding bases (FASTA)
          </MenuItem>
          <MenuItem icon={<FileSpreadsheet size={13} />} onSelect={() => exportAs('csv')}>
            Table (CSV)
          </MenuItem>
        </ContextMenuPopup>
      )}

      <ConfirmDialog
        open={confirmAddAll}
        title="Add every ORF"
        message={`Add ${n(convertible.length)} ORFs to the document as CDS features? This can be undone.`}
        buttons={[
          { label: 'Cancel', value: 'cancel' },
          { label: `Add ${n(convertible.length)}`, value: 'add', variant: 'primary' },
        ]}
        onResult={value => {
          if (value === 'add') applyOrfs()
          setConfirmAddAll(false)
        }}
      />
    </div>
  )
}

const rowId = (key: string) => `fd-orf-${key.replace(/[^a-zA-Z0-9-]/g, '_')}`

/** A column heading that sorts by it; pressed again, the other way. */
function SortHeader({ label, id, sort, onSort, num }: {
  label: string; id: SortKey; sort: Sort; onSort: (key: SortKey) => void; num?: boolean
}) {
  const on = sort.key === id
  return (
    <button
      type="button"
      className={`fd-th ${num ? 'num' : ''} ${on ? 'on' : ''}`}
      onClick={() => onSort(id)}
      aria-label={`Sort by ${label.toLowerCase()}${on ? (sort.desc ? ', descending' : ', ascending') : ''}`}
    >
      {label}
      {on && <span className="fd-th-dir" aria-hidden>{sort.desc ? '↓' : '↑'}</span>}
    </button>
  )
}

/** Why an ORF is partial. Its ends are those of the bases searched: the sequence, or a selection of it. */
function partialText(orf: ORFResult): string {
  if (orf.partialStart && orf.partialEnd) return 'Open from end to end of the bases searched: no start codon and no stop'
  if (orf.partialStart) return "Runs off the 5' end of the bases searched: no start codon"
  return "Runs off the 3' end of the bases searched: no stop codon"
}

interface InspectorProps {
  orf: ORFResult
  codeId: number
  at: (i: number) => string
  readOnly: boolean
  onAdd: () => void
}

/** The ORF in focus: where it is, what it encodes, and what to do with it. */
function OrfInspector({ orf, codeId, at, readOnly, onAdd }: InspectorProps) {
  const sequence = useEditorStore(s => s.doc.sequence)
  const annotations = useEditorStore(s => s.doc.annotations)
  const ann = useMemo(() => new Annotation(orfOverlayData(orf, codeId)), [orf, codeId])
  const protein = useMemo(() => orfProtein(orf, sequence, codeId), [orf, sequence, codeId])
  const codons = orfCodons(orf, sequence)
  const annotated = isOrfAnnotated(orf, annotations)
  const aa = orfAminoAcids(orf)
  const bp = orfLengthBp(orf, sequence.length)

  return (
    <div className="fdi">
      <div className="fdi-head">
        <span className="fd-swatch" style={{ backgroundColor: orfColor(orf.strand, orf.frame) }} />
        <span className="fdi-title">ORF {frameLabel(orf)}</span>
        {(orf.partialStart || orf.partialEnd) && <span className="fd-chip" title={partialText(orf)}>partial</span>}
      </div>
      <dl className="fdi-grid">
        <dt>Location</dt>
        <dd>{at(orf.start)}..{at(orf.end - 1)}{orf.start > orf.end ? ', across the origin' : ''}</dd>
        <dt>Strand</dt>
        <dd>{orf.strand === 1 ? 'Forward' : 'Reverse'}, frame {frameLabel(orf)}</dd>
        <dt>Length</dt>
        <dd>{n(aa)} aa, {formatBp(bp)}</dd>
        <dt>Start</dt>
        <dd>{codons.start ?? 'none: runs off the start'}</dd>
        <dt>Stop</dt>
        <dd>{codons.stop ?? 'none: runs off the end'}</dd>
        {protein && (
          <>
            <dt>Mass</dt>
            <dd>{formatMass(proteinMass(protein).average)}</dd>
          </>
        )}
      </dl>
      <div className="fdi-label">Protein</div>
      <div className="fdi-seq">{protein}</div>
      {annotated && <p className="fdi-note">A CDS already covers this ORF.</p>}
      <div className="fdi-actions">
        {!annotated && !readOnly && (
          <button className="btn btn-sm btn-primary" onClick={onAdd} title="Add this ORF to the document as a CDS feature">
            <Plus size={12} /> Add as CDS
          </button>
        )}
        <button className="btn btn-sm" onClick={() => void copyText(protein, 'Protein copied')} title="Copy the protein, one letter per residue">
          <Copy size={12} /> Copy protein
        </button>
        <button className="btn btn-sm" onClick={() => useEditorStore.getState().translateToProtein({ annotation: ann })} title="Open the protein as a sequence of its own">
          <Atom size={12} /> Open as protein
        </button>
        <button className="btn btn-sm" onClick={() => blastFeatureProtein(ann)} title="Search the protein with BLASTp">
          <Globe size={12} /> BLASTp
        </button>
      </div>
    </div>
  )
}
