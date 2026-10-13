/**
 * The editor a feature row opens into: name, type, where it is, strand,
 * colour, its translation when it codes, and its qualifiers.
 *
 * Every field is one undo step. Text fields write through as you type (the
 * map and sequence follow along) under a key minted when the field takes
 * focus, so the typing folds into one step; positions are drafts committed
 * on Enter or when the field loses focus, and checked first, since a
 * half-typed number ("1" on the way to "1500") is not a place to put a
 * feature.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Plus, X, Copy, Atom, Info, TriangleAlert } from 'lucide-react'
import { useEditorStore } from '../../store'
import type { Annotation, AnnotationData, Strand } from '../../models/Annotation'
import { PRESET_COLORS } from '../../utils/annotation-constants'
import {
  annotationProtein, canTranslateAnnotation, issueMessages, translationIssues,
} from '../../utils/annotation-sequence'
import { locationError } from '../../utils/feature-location'
import { copyText } from '../../utils/clipboard'
import Chevron from '../Chevron'

type Patch = Partial<Omit<AnnotationData, 'id'>>

/**
 * A coalescing key per interaction with a field: minted on focus (or on a
 * colour picker's press), so one stretch of typing is one undo step and the
 * next visit to the field is another.
 */
function useEditKeys(annotationId: string) {
  const key = useRef<string | null>(null)
  const begin = useCallback((field: string) => {
    key.current = `edit:${annotationId}:${field}:${Date.now()}`
  }, [annotationId])
  return { begin, key }
}

/**
 * A 1-based position typed as a draft. Committed on Enter or blur; Escape
 * puts the stored value back. `onCommit` returns false to refuse the value,
 * which then reverts too.
 */
function PositionInput({ value, max, onCommit, label, disabled }: {
  value: number
  max: number
  onCommit: (v: number) => boolean
  label: string
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(String(value))
  const editing = useRef(false)
  useEffect(() => { if (!editing.current) setDraft(String(value)) }, [value])

  const commit = () => {
    editing.current = false
    const n = parseInt(draft, 10)
    if (!Number.isFinite(n) || n === value || !onCommit(n)) setDraft(String(value))
  }

  return (
    <input
      className="input ft-input ft-num"
      type="number"
      min={1}
      max={max}
      aria-label={label}
      value={draft}
      disabled={disabled}
      onFocus={() => { editing.current = true }}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); editing.current = true }
        else if (e.key === 'Escape') { editing.current = false; setDraft(String(value)) }
      }}
    />
  )
}

// --- Qualifiers ---

const COMMON_QUALIFIERS = [
  'note', 'product', 'gene', 'locus_tag', 'label',
  'translation', 'codon_start', 'transl_table',
  'db_xref', 'protein_id', 'organism', 'mol_type',
]

function QualifiersEditor({ annotation, update, begin }: {
  annotation: Annotation
  update: (patch: Patch, coalesce?: boolean) => void
  begin: (field: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [addingKey, setAddingKey] = useState('')
  const [addingVal, setAddingVal] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)

  const quals = annotation.qualifiers
  const entries = Object.entries(quals)

  const setQualifier = (key: string, values: string[], coalesce = false) => {
    const next = { ...annotation.qualifiers }
    if (values.length === 0) delete next[key]
    else next[key] = values
    update({ qualifiers: next }, coalesce)
  }

  const handleAdd = () => {
    const key = addingKey.trim().replace(/^\//, '')
    if (!key) return
    setQualifier(key, [...(annotation.qualifiers[key] || []), addingVal.trim()])
    setAddingKey('')
    setAddingVal('')
    setShowAddForm(false)
  }

  return (
    <div className="ft-quals">
      <button className="ft-quals-toggle" onClick={() => setOpen(v => !v)}>
        <Chevron open={open} size={11} />
        <span>Qualifiers</span>
        {entries.length > 0 && <span className="ft-quals-count">{entries.reduce((n, [, v]) => n + v.length, 0)}</span>}
      </button>

      {open && (
        <div className="ft-quals-body disclose">
          {entries.length === 0 && !showAddForm && <div className="ft-quals-empty">No qualifiers</div>}

          {entries.map(([key, values]) => (
            <div key={key} className="ft-qual-group">
              <div className="ft-qual-key">/{key}</div>
              {values.map((val, vi) => (
                <div key={vi} className="ft-qual-val-row">
                  <input
                    className="input ft-input ft-qual-val-input"
                    value={val}
                    aria-label={`/${key} value`}
                    onFocus={() => begin(`q:${key}:${vi}`)}
                    onChange={e => {
                      const next = [...values]
                      next[vi] = e.target.value
                      setQualifier(key, next, true)
                    }}
                    spellCheck={false}
                  />
                  <button
                    className="ft-qual-del"
                    title="Remove value"
                    onClick={() => setQualifier(key, values.filter((_, i) => i !== vi))}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          ))}

          {showAddForm ? (
            <div className="ft-qual-add-form">
              <div className="ft-qual-add-row">
                <select className="select ft-select ft-qual-key-select" value={addingKey} onChange={e => setAddingKey(e.target.value)}>
                  <option value="">Key…</option>
                  {COMMON_QUALIFIERS.filter(q => !quals[q]).map(q => <option key={q} value={q}>{q}</option>)}
                </select>
                <input
                  className="input ft-input ft-qual-key-input"
                  placeholder="or type key"
                  value={addingKey}
                  onChange={e => setAddingKey(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <input
                className="input ft-input"
                placeholder="Value"
                value={addingVal}
                onChange={e => setAddingVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd() } }}
                spellCheck={false}
              />
              <div className="ft-qual-add-actions">
                <button className="btn btn-sm btn-primary" onClick={handleAdd} disabled={!addingKey.trim()}>Add</button>
                <button className="btn btn-sm" onClick={() => { setShowAddForm(false); setAddingKey(''); setAddingVal('') }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="ft-qual-add-btn" onClick={() => setShowAddForm(true)}>
              <Plus size={11} /> Add qualifier
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// --- Location ---

/** Start..end of a feature in one piece. */
function RangeEditor({ annotation: a, seqLen, circular, update }: {
  annotation: Annotation
  seqLen: number
  circular: boolean
  update: (patch: Patch) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const commit = (start: number, end: number) => {
    const err = locationError(start, end, null, seqLen, circular)
    setError(err)
    if (err) return false
    update({ start, end })
    return true
  }
  return (
    <>
      <div className="ft-row">
        <label>Range</label>
        <div className="ft-range-inputs">
          <PositionInput label="Start" value={a.start + 1} max={seqLen} onCommit={v => commit(v - 1, a.end)} />
          <span>..</span>
          <PositionInput label="End" value={a.end} max={seqLen} onCommit={v => commit(a.start, v)} />
        </div>
      </div>
      {error && <div className="ft-loc-error" role="alert">{error}</div>}
    </>
  )
}

/**
 * The parts of a joined feature, each editable. Start and end follow the
 * first and last part, so the model keeps the parts (it drops any that
 * disagree with the span, which is how editing the overall range used to
 * turn a spliced CDS into one piece without a word).
 */
function PartsEditor({ annotation: a, parts, seqLen, circular, update }: {
  annotation: Annotation
  parts: [number, number][]
  seqLen: number
  circular: boolean
  update: (patch: Patch) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const commitPart = (k: number, next: [number, number]) => {
    const segments = parts.map((p, i) => (i === k ? next : p))
    const start = segments[0][0]
    const end = segments[segments.length - 1][1]
    const err = locationError(start, end, segments, seqLen, circular)
    setError(err)
    if (err) return false
    update({ start, end, segments })
    return true
  }
  return (
    <div className="ft-row ft-row-top">
      <label>Parts</label>
      <div className="ft-parts">
        {parts.map(([s, e], k) => (
          <div key={k} className="ft-part-row">
            <span className="ft-part-idx">{k + 1}</span>
            <PositionInput label={`Part ${k + 1} start`} value={s + 1} max={seqLen} onCommit={v => commitPart(k, [v - 1, e])} />
            <span>..</span>
            <PositionInput label={`Part ${k + 1} end`} value={e} max={seqLen} onCommit={v => commitPart(k, [s, v])} />
          </div>
        ))}
        {error && <div className="ft-loc-error" role="alert">{error}</div>}
        <button
          className="btn btn-sm ft-parts-merge"
          title="Make the feature one span from the first part's start to the last part's end, the gaps included"
          onClick={() => update({ segments: undefined })}
        >
          Make One Span ({a.start + 1}..{a.end})
        </button>
      </div>
    </div>
  )
}

// --- Translation ---

function TranslationBlock({ annotation }: { annotation: Annotation }) {
  // Keyed on the document, not the sequence: base edits change the
  // sequence in place, so its identity says nothing about its bases.
  const doc = useEditorStore(s => s.doc)
  const protein = useMemo(() => annotationProtein(annotation, doc.sequence), [annotation, doc])
  const issues = useMemo(() => issueMessages(translationIssues(annotation, doc.sequence)), [annotation, doc])
  const residues = protein.endsWith('*') ? protein.length - 1 : protein.length
  return (
    <div className="ft-protein">
      <div className="ft-protein-head">
        <span className="ft-protein-title">Translation</span>
        <span className="ft-protein-len">{residues} aa</span>
        <button
          className="fs-icon-btn"
          title="Copy the amino acid sequence"
          onClick={() => copyText(protein, `Copied ${protein.length} aa from "${annotation.name}"`)}
        >
          <Copy size={12} />
        </button>
        <button
          className="fs-icon-btn"
          title="Open the protein as a document of its own, linked back to these codons"
          onClick={() => useEditorStore.getState().translateToProtein({ annotation })}
        >
          <Atom size={12} />
        </button>
      </div>
      {issues.length > 0 && (
        <div className="ft-issues">
          {issues.map(m => (
            <div key={m.text} className={`ft-issue ${m.severity}`}>
              {m.severity === 'note' ? <Info size={11} /> : <TriangleAlert size={11} />}
              {m.text}
            </div>
          ))}
        </div>
      )}
      <div className="ft-protein-seq">{protein}</div>
    </div>
  )
}

// --- The editor ---

export default function FeatureEditor({
  annotation: a, featureTypes, readOnly, focusName, onDone, onDelete,
}: {
  annotation: Annotation
  featureTypes: readonly string[]
  readOnly: boolean
  /** Bumped to put the caret in the name field with the name selected (F2). */
  focusName: number
  onDone: () => void
  onDelete: () => void
}) {
  const sequence = useEditorStore(s => s.doc.sequence)
  const updateAnnotation = useEditorStore(s => s.updateAnnotation)
  const seqLen = sequence.length
  const circular = sequence.topology === 'circular'
  const { begin, key } = useEditKeys(a.id)

  const update = useCallback((patch: Patch, coalesce = false) => {
    updateAnnotation(a.id, patch, coalesce && key.current ? { coalesceKey: key.current } : undefined)
  }, [a.id, updateAnnotation, key])

  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusName === 0) return
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [focusName])

  const translatable = canTranslateAnnotation(a, sequence)

  return (
    <fieldset className="ft-editor" disabled={readOnly} onClick={e => e.stopPropagation()}>
      <div className="ft-row">
        <label htmlFor={`ft-name-${a.id}`}>Name</label>
        <input
          id={`ft-name-${a.id}`}
          ref={nameRef}
          className="input ft-input"
          value={a.name}
          onFocus={() => begin('name')}
          onChange={e => update({ name: e.target.value }, true)}
          // Enter finishes, as it does in a rename: the list takes it.
          data-commit-on-enter
        />
      </div>
      <div className="ft-row">
        <label>Type</label>
        <select className="select ft-select" value={a.type} onChange={e => update({ type: e.target.value })}>
          {featureTypes.includes(a.type) ? null : <option value={a.type}>{a.type}</option>}
          {featureTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      {a.segments
        ? <PartsEditor annotation={a} parts={a.segments} seqLen={seqLen} circular={circular} update={update} />
        : <RangeEditor annotation={a} seqLen={seqLen} circular={circular} update={update} />}
      <div className="ft-row">
        <label>Strand</label>
        <select className="select ft-select" value={a.strand} onChange={e => update({ strand: parseInt(e.target.value) as Strand })}>
          <option value={1}>Forward (+)</option>
          <option value={-1}>Reverse (−)</option>
          <option value={0}>None</option>
        </select>
      </div>
      <div className="ft-row">
        <label>Color</label>
        <div className="ft-color-row">
          <div className="ft-color-presets">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                className={`ft-color-dot ${c === a.color ? 'active' : ''}`}
                style={{ backgroundColor: c }}
                title={c}
                onClick={() => update({ color: c })}
              />
            ))}
            <label className="ft-color-dot ft-color-custom" style={{ backgroundColor: a.color }} title="Custom color">
              <input
                type="color"
                value={a.color}
                // A colour input fires on every frame of a drag: one key per
                // press folds the drag into one undo step.
                onPointerDown={() => begin('color')}
                onFocus={() => begin('color')}
                onChange={e => update({ color: e.target.value }, true)}
              />
            </label>
          </div>
        </div>
      </div>
      {translatable && <TranslationBlock annotation={a} />}
      <QualifiersEditor annotation={a} update={update} begin={begin} />
      <div className="ft-actions">
        <button className="btn btn-sm" onClick={onDone}>Done</button>
        <button className="btn btn-sm ft-del-btn" onClick={onDelete}>Delete</button>
      </div>
    </fieldset>
  )
}
