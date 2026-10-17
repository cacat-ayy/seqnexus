/**
 * Enzymes typed rather than hunted for.
 *
 * Chips for the chosen enzymes and a text box that autocompletes. Typing
 * "EcoRI+BamHI" or pasting "EcoRI, BamHI" adds both. Every option shows how
 * often it cuts each sequence it is for, and flags enzymes whose sites
 * methylation blocks.
 *
 * With the box empty, the list offers recent enzymes and then the ones that
 * cut the first sequence once and every other sequence at all. For a gel lane
 * (one sequence) that is the single cutters a diagnostic digest wants; for a
 * cloning design (vector first) it is the enzymes that open the vector once
 * and release each insert.
 */

import './EnzymeField.css'
import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { ENZYME_DB, ENZYME_GROUPS, getEnzyme, type RestrictionEnzyme } from '../enzymes/db'
import { parseEnzymeList } from '../gel/parse'
import { findCutSites, cuttingSites } from '../enzymes/finder'
import { findUnblockedSites } from '../cloning/digest'
import type { SequenceSource } from '../gel/simulate'
import { STORAGE_KEYS } from '../storage/keys'

/** A sequence the enzymes are for. */
export interface CutTarget {
  source: SequenceSource
  /** Swatch beside its count, when there is more than one sequence. */
  color?: string
}

interface Props {
  value: string[]
  onChange: (enzymes: string[]) => void
  targets: CutTarget[]
  /** Shown in the empty box with nothing chosen. */
  placeholder?: string
  /** Heading over the suggestions offered before anything is typed. */
  suggestTitle?: string
}

const RECENT_KEY = STORAGE_KEYS.gelRecentEnzymes
const MAX_RECENT = 8
const MAX_OPTIONS = 40

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter(n => typeof n === 'string').slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

function rememberRecent(name: string): void {
  try {
    const next = [name, ...loadRecent().filter(n => n !== name)].slice(0, MAX_RECENT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch { /* storage blocked: recents are a nicety */ }
}

const COMMON = new Set(ENZYME_GROUPS['Common (6-cutters)'] ?? [])

const total = (counts: number[]) => counts.reduce((a, b) => a + b, 0)

export default function EnzymeField({ value, onChange, targets, placeholder, suggestTitle }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [unknown, setUnknown] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  /**
   * How often an enzyme cuts each target, in target order. Counted on demand
   * and kept until the targets change, so the whole database is only counted
   * once the list opens rather than on every render of the page around it.
   */
  const cutCounts = useMemo(() => {
    const cache = new Map<string, number[]>()
    return (e: RestrictionEnzyme): number[] => {
      let counts = cache.get(e.name)
      if (!counts) {
        counts = targets.map(({ source }) => cuttingSites(findCutSites(source.bases, e, source.topology)).length)
        cache.set(e.name, counts)
      }
      return counts
    }
  }, [targets])
  const hasTargets = targets.length > 0
  const cutsNothing = (e: RestrictionEnzyme) => hasTargets && total(cutCounts(e)) === 0

  const options = useMemo((): RestrictionEnzyme[] => {
    if (!open) return []
    const q = query.trim().toLowerCase()
    const chosen = new Set(value)
    let pool = ENZYME_DB.filter(e => !chosen.has(e.name))
    if (q) {
      pool = pool.filter(e => e.name.toLowerCase().includes(q) || e.recognition.toLowerCase().includes(q))
      // Name prefix first, then cutters before non-cutters, then alphabetical.
      const rank = (e: RestrictionEnzyme) =>
        (e.name.toLowerCase().startsWith(q) ? 0 : 2) + (hasTargets && total(cutCounts(e)) === 0 ? 1 : 0)
      return pool.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, MAX_OPTIONS)
    }
    // Empty box: recent enzymes, then the ones that cut the first target once
    // and every other target at all, common ones first.
    const recent = loadRecent().map(n => pool.find(e => e.name === n)).filter((e): e is RestrictionEnzyme => !!e)
    const useful = (e: RestrictionEnzyme) => {
      const counts = cutCounts(e)
      return counts[0] === 1 && counts.every(n => n > 0)
    }
    const suggested = hasTargets
      ? pool.filter(e => !recent.includes(e) && useful(e))
        .sort((a, b) => Number(COMMON.has(b.name)) - Number(COMMON.has(a.name)) || a.name.localeCompare(b.name))
      : []
    return [...recent, ...suggested].slice(0, MAX_OPTIONS)
  }, [open, query, value, cutCounts, hasTargets])

  /**
   * Enzymes whose every site on every target is blocked: by methylation, or
   * for want of it (DpnI on DNA that is not Dam-methylated).
   */
  const blocked = useMemo(() => {
    const set = new Set<string>()
    const methylated = targets.filter(t => t.source.damMethylated || t.source.dcmMethylated)
    for (const e of options) {
      const needsMethylation = e.dam === 'required' || e.dcm === 'required'
      const checked = needsMethylation ? targets : methylated
      if (checked.length === 0) continue
      const results = checked.map(({ source }) =>
        findUnblockedSites(source.bases, source.topology, [e], !!source.damMethylated, !!source.dcmMethylated))
      if (results.every(r => r.sites.length === 0) && results.some(r => r.blocked.length > 0)) set.add(e.name)
    }
    return set
  }, [options, targets])

  const add = useCallback((names: string[]) => {
    const next = [...value]
    for (const n of names) if (!next.includes(n)) { next.push(n); rememberRecent(n) }
    if (next.length !== value.length) onChange(next)
    setQuery('')
    setActive(0)
  }, [value, onChange])

  const commitText = useCallback((text: string) => {
    const { known, unknown: bad } = parseEnzymeList(text)
    setUnknown(bad)
    if (known.length > 0) add(known)
    else if (bad.length === 0) setQuery('')
  }, [add])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive(i => Math.min(options.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(i => Math.max(0, i - 1))
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (query.trim() && /[\s,+;/]/.test(query.trim())) {
        e.preventDefault()
        commitText(query)
      } else if (open && options[active] && (query.trim() || e.key === 'Enter')) {
        e.preventDefault()
        add([options[active].name])
      } else if (query.trim()) {
        e.preventDefault()
        commitText(query)
      }
    } else if (e.key === 'Backspace' && !query && value.length > 0) {
      onChange(value.slice(0, -1))
    } else if (e.key === 'Escape') {
      if (open) { e.stopPropagation(); setOpen(false) }
    }
  }

  const onInput = (text: string) => {
    // A separator typed after a name commits it, so "EcoRI+" adds EcoRI.
    if (/[,+;]\s*$/.test(text) || (/\s$/.test(text) && parseEnzymeList(text).known.length > 0 && parseEnzymeList(text).unknown.length === 0)) {
      commitText(text)
      return
    }
    setQuery(text)
    setUnknown([])
    setActive(0)
    setOpen(true)
  }

  const several = targets.length > 1
  const countsTitle = (counts: number[]) =>
    targets.map((t, i) => `${t.source.name}: ${counts[i]} cut${counts[i] === 1 ? '' : 's'}`).join('\n')

  return (
    <div className="ef">
      <div className="ef-box" onClick={() => inputRef.current?.focus()}>
        {value.map(name => {
          const enzyme = getEnzyme(name)
          return (
            <span key={name} className="ef-chip">
              {name}
              {enzyme && cutsNothing(enzyme) && (
                <span className="ef-chip-warn" title={several ? 'Cuts none of these sequences' : 'Does not cut this sequence'}>0×</span>
              )}
              <button
                type="button"
                className="ef-chip-x"
                aria-label={`Remove ${name}`}
                onClick={ev => { ev.stopPropagation(); onChange(value.filter(n => n !== name)) }}
              >
                <X size={10} />
              </button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          className="ef-input"
          value={query}
          placeholder={value.length === 0 ? (placeholder ?? 'Type e.g. EcoRI+BamHI') : 'Add enzyme'}
          role="combobox"
          aria-label="Enzymes"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
          onChange={e => onInput(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Text left in the box is what the user meant to choose. Dropped,
            // a typed "EcoRI" that was never confirmed silently meant no
            // enzymes; committed, it is added, or flagged as not recognised.
            if (query.trim()) commitText(query)
            setTimeout(() => setOpen(false), 120)
          }}
          onKeyDown={onKeyDown}
          onPaste={e => {
            const text = e.clipboardData.getData('text')
            if (/[\s,+;/]/.test(text.trim())) { e.preventDefault(); commitText(text) }
          }}
        />
      </div>
      {unknown.length > 0 && (
        <div className="ef-hint">Not recognised: {unknown.join(', ')}</div>
      )}
      {open && options.length > 0 && (
        <div className="ef-options" role="listbox" id={listId}>
          {!query.trim() && (
            <div className="ef-options-head">
              {targets.length > 0 ? (suggestTitle ?? 'Recent and single cutters') : 'Recent'}
            </div>
          )}
          {options.map((e, i) => {
            const counts = hasTargets ? cutCounts(e) : null
            return (
              <div
                key={e.name}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`ef-option ${i === active ? 'active' : ''}`}
                onMouseDown={ev => { ev.preventDefault(); add([e.name]) }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="ef-name">{e.name}</span>
                <span className="ef-site">{e.recognition}</span>
                {blocked.has(e.name) && <span className="ef-blocked" title={e.dam === 'required' || e.dcm === 'required' ? 'Cuts only methylated DNA, and no site here is' : 'Every site is blocked by dam/dcm methylation'}>blocked</span>}
                {counts && (
                  <span className="ef-counts" title={countsTitle(counts)}>
                    {counts.map((n, t) => (
                      <span key={t} className={`ef-cuts ${n === 0 ? 'zero' : n === 1 ? 'one' : ''}`}>
                        {several && targets[t].color && (
                          <span className="ef-swatch" style={{ background: targets[t].color }} aria-hidden="true" />
                        )}
                        {n}×
                      </span>
                    ))}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
