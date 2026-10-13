import './FindDialog.css'
/**
 * The Find panel for the sequence view.
 *
 * A compact card that floats over the view, below the minimap so the hit
 * marks there stay in sight. Top to bottom: the query with the hit count and
 * navigation, the options as toggles that keep their places in both modes
 * (so nothing moves while typing or switching), the list of hits, and a
 * Replace section that opens on demand.
 *
 * The matching itself is in search/find.ts; the store runs it and keeps the
 * hits current through edits. This component owns only the query being typed
 * and the panel's own state (position, Replace open or not).
 */

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import {
  useEditorStore, defaultSearchOptions, selectionSegments, matchSelection,
  type SearchOptions, type SearchMatch,
} from '../store'
import {
  MAX_MISMATCHES, cleanQuery, cleanReplacement, featureForHit, matchContext, mismatchPositions,
} from '../search/find'
import { geneticCode, translateWith } from '../codon/genetic-codes'
import { displayPosition } from '../models/Document'
import { notify } from '../toast'
import Chevron from './Chevron'
import {
  Search, ChevronUp, ChevronDown, X, ArrowLeftRight, Regex, Replace, ReplaceAll,
} from 'lucide-react'

/** A search handed to the panel from elsewhere, such as a peptide to find in a DNA document. */
export interface FindPreset {
  query: string
  options: SearchOptions
  /** Changes on every new preset, so the same query can be asked for twice. */
  nonce: number
}

interface FindModalProps {
  open: boolean
  /** Changes on every request to find (Ctrl+F, the toolbar), open or not. */
  focusRequest: number
  /** A query and options to search instead of the selection. */
  preset?: FindPreset | null
  onClose: () => void
}

/** Gap between the card and the edges it sits against. */
const GAP = 8
/** A selection this long or shorter becomes the query when Find opens. */
const PREFILL_MAX = 1000
/** Rows of the hit list in the DOM at once, around the current hit. */
const LIST_WINDOW = 200
/** Bases of context shown either side of a hit (two codons). */
const FLANK = 6

/** Where the panel was last dragged to, for the rest of the session. */
let savedPos: { left: number; top: number } | null = null

const keyOf = (sel: { anchor: number; caret: number }) => `${sel.anchor}:${sel.caret}`

export default function FindDialog({ open, focusRequest, preset, onClose }: FindModalProps) {
  const search = useEditorStore(s => s.search)
  const setSearch = useEditorStore(s => s.setSearch)
  const nextMatch = useEditorStore(s => s.nextMatch)
  const prevMatch = useEditorStore(s => s.prevMatch)
  const goToMatch = useEditorStore(s => s.goToMatch)
  const clearSearch = useEditorStore(s => s.clearSearch)
  const replaceCurrentMatch = useEditorStore(s => s.replaceCurrentMatch)
  const replaceAllMatches = useEditorStore(s => s.replaceAllMatches)
  const readOnly = useEditorStore(s => s.readOnly)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const doc = useEditorStore(s => s.doc)
  const translationCodeId = useEditorStore(s => s.translationCodeId)

  const [query, setQuery] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [options, setOptions] = useState<SearchOptions>({ ...defaultSearchOptions })
  const [showReplace, setShowReplace] = useState(false)

  // Kept mounted through the exit animation.
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)

  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const posRef = useRef(pos)
  posRef.current = pos
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

  const cardRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  /** The selection of the last hit shown, so reopening on it does not turn
   *  the hit's bases into the query in place of what was typed. */
  const lastHitRef = useRef<string | null>(null)
  /** A selection just made the query; search nothing else until it lands. */
  const pendingQueryRef = useRef<string | null>(null)
  const [searchNonce, setSearchNonce] = useState(0)

  // ---- Open and close ----
  // The store's search is cleared as the panel starts to close, so the
  // highlights go with it rather than after the animation.
  const wasOpen = useRef(false)
  const openRef = useRef(open)
  openRef.current = open
  // Every request to find shows the panel, not only a change of `open`: a
  // request made while it is already open must not find it hidden.
  useEffect(() => {
    if (open) {
      setClosing(false)
      setVisible(true)
    } else if (wasOpen.current) {
      clearSearch()
      setClosing(true)
    }
    wasOpen.current = open
  }, [open, focusRequest, clearSearch])

  // Reopened just as the exit animation ended, the handler still saw the
  // panel closing and hid it after the reopen had shown it: `open` stayed
  // true, so no later Find (Ctrl+F or the toolbar) could bring it back. The
  // end of the exit animation hides the panel only while it is still closed,
  // and only its own animation counts, not one bubbling from inside it.
  const handleAnimationEnd = useCallback((e: React.AnimationEvent) => {
    if (e.target !== e.currentTarget || !closing || openRef.current) return
    setVisible(false)
    setClosing(false)
  }, [closing])

  // ---- Focus, and the selection as the query ----
  // Runs on every request to find, so Ctrl+F on an open panel focuses it
  // again, and picks up a selection made since the last search. Waits for
  // the card to mount: on the first open it renders one pass after `open`.
  // A preset (a peptide to find in this DNA) takes the place of the selection
  // as the query, with its own options.
  const presetNonceRef = useRef(0)
  useEffect(() => {
    if (!open || !visible || !preset || preset.nonce === presetNonceRef.current) return
    presetNonceRef.current = preset.nonce
    pendingQueryRef.current = preset.query
    setQuery(preset.query)
    setOptions({ ...preset.options })
    setSearchNonce(k => k + 1)
  }, [open, visible, preset])

  useEffect(() => {
    if (!open || !visible) return
    const st = useEditorStore.getState()
    const L = st.doc.sequence.length
    const segs = selectionSegments(st.selection, st.doc.sequence.topology, L)
    const len = segs.reduce((n, [s, e]) => n + e - s, 0)
    const presetPending = !!preset && preset.nonce !== presetNonceRef.current
    if (!presetPending && len > 0 && len <= PREFILL_MAX && keyOf(st.selection) !== lastHitRef.current) {
      const text = segs.map(([s, e]) => st.doc.sequence.basesIn(s, e)).join('').toUpperCase()
      // Hold the search back until this query is in state: searching the
      // old one first would move the selection off the bases being searched.
      pendingQueryRef.current = text
      setQuery(text)
      // The selection is bases, so it is searched as bases.
      setOptions(o => (o.mode === 'nucleotide' ? o : { ...o, mode: 'nucleotide' }))
      setSearchNonce(k => k + 1)
    }
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [focusRequest, open, visible, preset])

  // ---- Search ----
  // Also on a tab switch: the query belongs to the panel, the hits to the
  // tab, so the new tab is searched for what the panel shows.
  useEffect(() => {
    if (!open || !visible) return
    if (pendingQueryRef.current !== null) {
      if (pendingQueryRef.current !== query) return
      pendingQueryRef.current = null
    }
    setSearch(query, options)
  }, [query, options, open, visible, activeTabId, searchNonce, setSearch])

  const current = search.matches[search.currentMatch] as SearchMatch | undefined
  useEffect(() => {
    if (current) lastHitRef.current = keyOf(matchSelection(current, doc.sequence.length))
  }, [current, doc.sequence.length])

  const updateOption = useCallback(<K extends keyof SearchOptions>(key: K, value: SearchOptions[K]) => {
    setOptions(prev => ({ ...prev, [key]: value }))
  }, [])

  // ---- Placement ----
  // Below the sequence minimap and against the right edge, until the user
  // drags it somewhere; then wherever it was left. Kept inside the view as
  // the view resizes.
  useLayoutEffect(() => {
    if (!visible) return
    const card = cardRef.current
    const parent = card?.parentElement
    if (!card || !parent) return
    const place = () => {
      const pr = parent.getBoundingClientRect()
      let p = savedPos
      if (!p) {
        const minimap = parent.querySelector('.minimap[data-kind="sequence"]')
        const top = minimap ? minimap.getBoundingClientRect().bottom - pr.top + GAP : GAP
        p = { left: pr.width - card.offsetWidth - GAP, top }
      }
      setPos({
        left: Math.max(0, Math.min(p.left, pr.width - card.offsetWidth)),
        // Only the query row has to stay in view; the list may run below.
        top: Math.max(0, Math.min(p.top, pr.height - 48)),
      })
    }
    place()
    const ro = new ResizeObserver(place)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [visible])

  // ---- Dragging, from any empty part of the card ----
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      const card = cardRef.current
      const parent = card?.parentElement
      if (!d || !card || !parent) return
      const pr = parent.getBoundingClientRect()
      setPos({
        left: Math.max(0, Math.min(d.left + e.clientX - d.x, pr.width - card.offsetWidth)),
        top: Math.max(0, Math.min(d.top + e.clientY - d.y, pr.height - 48)),
      })
    }
    const onUp = () => {
      setDragging(false)
      dragRef.current = null
      savedPos = posRef.current
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
  }, [dragging])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || !posRef.current) return
    if ((e.target as HTMLElement).closest('input, button, label, .find-hits')) return
    e.preventDefault()
    dragRef.current = { x: e.clientX, y: e.clientY, ...posRef.current }
    setDragging(true)
  }, [])

  // ---- Keys ----
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      // Inside the panel Ctrl+F would open the browser's own find bar.
      e.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [onClose])

  const handleQueryKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) prevMatch()
      else nextMatch()
    }
  }, [nextMatch, prevMatch])

  // ---- The hit list ----
  const seqLen = doc.sequence.length
  const circular = doc.sequence.topology === 'circular'
  const origin = doc.metadata?.displayOrigin || 0
  // On a protein document the query is residues and there is one strand, so
  // the DNA/Protein choice and the strand toggle have nothing to say.
  const residues = doc.sequence.alphabet === 'protein'
  const protein = options.mode === 'protein' && !residues
  const n = search.matches.length
  const cur = search.currentMatch
  const winStart = n <= LIST_WINDOW ? 0 : Math.max(0, Math.min(cur - 50, n - LIST_WINDOW))
  const cleanedQuery = cleanQuery(search.query, search.options)

  const rows = useMemo(() => {
    if (!visible) return []
    const code = geneticCode(translationCodeId)
    const basesIn = (s: number, e: number) => doc.sequence.basesIn(s, e)
    const dp = (p: number) => displayPosition(((p % seqLen) + seqLen) % seqLen, origin, seqLen).toLocaleString('en-US')
    const isProtein = search.options.mode === 'protein' && !residues
    return search.matches.slice(winStart, winStart + LIST_WINDOW).map((m, k) => {
      const ctx = matchContext(m, FLANK, seqLen, circular, basesIn)
      let before = ctx.before, hit = ctx.hit, after = ctx.after
      let marks: number[] = []
      if (isProtein) {
        // Whole codons only: trim the context to the codons next to the hit.
        before = translateWith(code, before.slice(before.length % 3))
        hit = translateWith(code, hit)
        after = translateWith(code, after)
      } else if (m.mismatches > 0) {
        marks = mismatchPositions(hit, cleanedQuery, search.options.ambiguity)
      }
      const len = m.end - m.start
      return {
        index: winStart + k,
        m,
        where: len === 1 ? dp(m.start) : `${dp(m.start)}-${dp(m.end - 1)}`,
        feature: featureForHit(m, doc.annotations, seqLen)?.name ?? null,
        before, hit, after, marks,
      }
    })
  }, [visible, search.matches, search.options, winStart, doc, seqLen, circular, origin, translationCodeId, cleanedQuery, residues])

  // Keep the current row in sight as the hits are stepped through.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cur, winStart])

  if (!visible) return null

  // ---- Status ----
  const total = `${n.toLocaleString('en-US')}${search.truncated ? '+' : ''}`
  const count = !search.query || search.error ? '' : n === 0 ? 'No matches' : `${(cur + 1).toLocaleString('en-US')} / ${total}`

  const nucleotideRegex = options.isRegex && !protein
  const strandsTitle = nucleotideRegex
    ? 'A regular expression is searched on the forward strand only'
    : protein ? 'Translate and search all six frames, not only the three forward ones' : 'Also find the reverse complement'
  const ambiguityTitle = options.isRegex
    ? 'Not used with a regular expression: write the alternatives into it'
    : protein || residues ? 'X matches any amino acid, B is D or N, Z is E or Q, J is I or L' : 'IUPAC codes match the bases they stand for: N any base, R A or G, Y C or T…'
  const mismatchTitle = options.isRegex
    ? 'Not available with a regular expression'
    : protein ? 'Mismatches are counted in bases: switch to DNA'
    : residues ? 'Allow this many residues to differ from the query' : 'Allow this many bases to differ from the query'

  const replacement = cleanReplacement(replaceText, search.options.mode, doc.sequence.alphabet)
  const replaceBlocked = readOnly ? 'The sequence is read-only' : replacement.error
  const doReplaceAll = () => {
    const { replaced, skipped } = replaceAllMatches(replaceText)
    if (replaced === 0) return
    const what = `Replaced ${replaced.toLocaleString('en-US')} match${replaced === 1 ? '' : 'es'}`
    notify.success(skipped > 0
      ? `${what}. ${skipped.toLocaleString('en-US')} overlapping hit${skipped === 1 ? ' was' : 's were'} left as they were.`
      : what)
  }

  const strandGlyph = (m: SearchMatch) => (m.strand === 1 ? '→' : m.strand === -1 ? '←' : '⇄')
  const strandName = (m: SearchMatch) => (m.strand === 1 ? 'Forward strand' : m.strand === -1 ? 'Reverse strand' : 'Both strands')

  return (
    <div
      ref={cardRef}
      className={`find-modal${closing ? ' closing' : ''}${dragging ? ' dragging' : ''}`}
      style={pos ? { left: pos.left, top: pos.top } : undefined}
      role="search"
      aria-label="Find in sequence"
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onAnimationEnd={handleAnimationEnd}
    >
      {/* Query, count, navigation */}
      <div className="find-query-row">
        <div className={`find-query${search.error ? ' invalid' : ''}`}>
          <Search size={13} className="find-query-icon" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            className="find-query-input"
            placeholder={options.isRegex ? 'Regular expression' : protein || residues ? 'Amino acids, e.g. MKT' : 'Bases, e.g. GAATTC'}
            aria-label="Find"
            aria-invalid={!!search.error}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleQueryKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
          <span className="find-count" aria-live="polite">{count}</span>
        </div>
        <button className="find-icon-btn" onClick={prevMatch} disabled={n === 0} title="Previous hit (Shift+Enter)" aria-label="Previous hit">
          <ChevronUp size={14} />
        </button>
        <button className="find-icon-btn" onClick={nextMatch} disabled={n === 0} title="Next hit (Enter)" aria-label="Next hit">
          <ChevronDown size={14} />
        </button>
        <button className="find-icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close find">
          <X size={14} />
        </button>
      </div>

      {/* Options: the same controls in both modes, only enabled or not */}
      <div className="find-options">
        {!residues && (
          <div className="seg seg-sm find-seg" role="group" aria-label="Search as">
            <button className={!protein ? 'active' : ''} aria-pressed={!protein} onClick={() => updateOption('mode', 'nucleotide')}>DNA</button>
            <button className={protein ? 'active' : ''} aria-pressed={protein} onClick={() => updateOption('mode', 'protein')}>Protein</button>
          </div>
        )}
        {!residues && (
          <button
            className={`find-chip${options.revComplement && !nucleotideRegex ? ' on' : ''}`}
            aria-pressed={options.revComplement && !nucleotideRegex}
            disabled={nucleotideRegex}
            onClick={() => updateOption('revComplement', !options.revComplement)}
            title={strandsTitle}
          >
            <ArrowLeftRight size={12} /> Both strands
          </button>
        )}
        <button
          className={`find-chip${options.ambiguity && !options.isRegex ? ' on' : ''}`}
          aria-pressed={options.ambiguity && !options.isRegex}
          disabled={options.isRegex}
          onClick={() => updateOption('ambiguity', !options.ambiguity)}
          title={ambiguityTitle}
        >
          <span className="find-chip-glyph" aria-hidden>N</span> Ambiguity
        </button>
        <button
          className={`find-chip${options.isRegex ? ' on' : ''}`}
          aria-pressed={options.isRegex}
          onClick={() => updateOption('isRegex', !options.isRegex)}
          title="Search with a regular expression"
        >
          <Regex size={12} /> Regex
        </button>
        <div className="find-mismatch" role="group" aria-label="Mismatches allowed" title={mismatchTitle}>
          <span className="find-mismatch-label">Mismatches</span>
          <div className="seg seg-sm find-seg find-seg-small">
            {Array.from({ length: MAX_MISMATCHES + 1 }, (_, k) => (
              <button
                key={k}
                className={options.mismatches === k && !options.isRegex && !protein ? 'active' : ''}
                aria-pressed={options.mismatches === k}
                disabled={options.isRegex || protein}
                onClick={() => updateOption('mismatches', k)}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Hits, or why there are none */}
      {search.error ? (
        <div className="find-message find-message-error" role="alert">{search.error}</div>
      ) : n > 0 && (
        <div className="find-hits" ref={listRef} role="listbox" aria-label="Hits">
          {winStart > 0 && (
            <div className="find-hits-more">{winStart.toLocaleString('en-US')} earlier hit{winStart === 1 ? '' : 's'}</div>
          )}
          {rows.map(r => (
            <div
              key={r.index}
              role="option"
              aria-selected={r.index === cur}
              className={`find-hit${r.index === cur ? ' current' : ''}`}
              onClick={() => goToMatch(r.index)}
            >
              <div className="find-hit-meta">
                <span className="find-hit-pos">{r.where}</span>
                {!residues && (
                  <span className="find-hit-strand" title={strandName(r.m)} aria-label={strandName(r.m)}>
                    {strandGlyph(r.m)}
                    {r.m.frame !== undefined && (
                      <span className="find-hit-frame" title="Reading frame">{r.m.strand === -1 ? '-' : '+'}{r.m.frame + 1}</span>
                    )}
                  </span>
                )}
                <span className={`find-hit-feature${r.feature ? '' : ' none'}`}>{r.feature ?? 'no feature'}</span>
                {r.m.mismatches > 0 && (
                  <span className="find-hit-mm" title={`${r.m.mismatches} mismatch${r.m.mismatches === 1 ? '' : 'es'}`}>
                    {r.m.mismatches} mm
                  </span>
                )}
              </div>
              <div className="find-hit-context">
                <span className="find-ctx-flank">{r.before}</span>
                <span className="find-ctx-hit">
                  {r.marks.length === 0 ? r.hit : [...r.hit].map((c, j) => (
                    r.marks.includes(j) ? <span key={j} className="find-ctx-mm">{c}</span> : c
                  ))}
                </span>
                <span className="find-ctx-flank">{r.after}</span>
              </div>
            </div>
          ))}
          {winStart + rows.length < n && (
            <div className="find-hits-more">+ {(n - winStart - rows.length).toLocaleString('en-US')} more</div>
          )}
          {search.truncated && (
            <div className="find-hits-more">Only the first {n.toLocaleString('en-US')} hits are kept</div>
          )}
        </div>
      )}

      {/* Replace */}
      <div className="find-replace">
        <button className="find-replace-toggle" aria-expanded={showReplace} onClick={() => setShowReplace(v => !v)}>
          <Chevron open={showReplace} size={13} /> Replace
        </button>
        {showReplace && (
          <div className="find-replace-body disclose">
            <input
              type="text"
              className={`find-replace-input${replacement.error ? ' invalid' : ''}`}
              placeholder={protein ? 'Replace with DNA' : residues ? 'Replace with residues' : 'Replace with'}
              aria-label="Replace with"
              aria-invalid={!!replacement.error}
              value={replaceText}
              onChange={e => setReplaceText(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              onKeyDown={e => {
                if (e.key === 'Enter' && !replaceBlocked) {
                  e.preventDefault()
                  replaceCurrentMatch(replaceText)
                }
              }}
            />
            {replacement.error && <div className="find-message find-message-error">{replacement.error}</div>}
            <div className="find-replace-actions">
              <button
                className="find-replace-btn"
                onClick={() => replaceCurrentMatch(replaceText)}
                disabled={!current || !!replaceBlocked}
                title={replaceBlocked ?? (residues ? 'Replace the current hit' : 'Replace the current hit; a reverse-strand hit gets the reverse complement')}
              >
                <Replace size={13} /> Replace
              </button>
              <button
                className="find-replace-btn"
                onClick={doReplaceAll}
                disabled={n === 0 || !!replaceBlocked || search.truncated}
                title={replaceBlocked ?? (search.truncated ? 'Too many hits to replace at once' : 'Replace every hit')}
              >
                <ReplaceAll size={13} /> Replace all
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
