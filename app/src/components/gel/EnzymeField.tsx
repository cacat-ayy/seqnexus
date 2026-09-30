/**
 * Enzymes for a digest lane, typed rather than hunted for.
 *
 * Chips for the chosen enzymes and a text box that autocompletes. Typing
 * "EcoRI+BamHI" or pasting "EcoRI, BamHI" adds both. With the box empty, the
 * list offers the enzymes that cut this sequence once, which is what a
 * diagnostic digest usually wants. Every option shows how often it cuts, and
 * flags enzymes whose sites methylation blocks.
 */

import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { ENZYME_DB, ENZYME_GROUPS, type RestrictionEnzyme } from '../../enzymes/db'
import { parseEnzymeList } from '../../gel/parse'
import { findCutSites } from '../../enzymes/finder'
import { findUnblockedSites } from '../../cloning/digest'
import type { SequenceSource } from '../../gel/simulate'

interface Props {
  value: string[]
  onChange: (enzymes: string[]) => void
  source: SequenceSource | null
}

const RECENT_KEY = 'seqnexus_gel_recent_enzymes'
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

export default function EnzymeField({ value, onChange, source }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [unknown, setUnknown] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const cutCounts = useMemo(() => {
    const map = new Map<string, number>()
    if (!source) return map
    for (const e of ENZYME_DB) map.set(e.name, findCutSites(source.bases, e, source.topology).length)
    return map
  }, [source])

  const options = useMemo((): RestrictionEnzyme[] => {
    const q = query.trim().toLowerCase()
    const chosen = new Set(value)
    let pool = ENZYME_DB.filter(e => !chosen.has(e.name))
    if (q) {
      pool = pool.filter(e => e.name.toLowerCase().includes(q) || e.recognition.toLowerCase().includes(q))
      // Name prefix first, then cutters before non-cutters, then alphabetical.
      const rank = (e: RestrictionEnzyme) =>
        (e.name.toLowerCase().startsWith(q) ? 0 : 2) + ((cutCounts.get(e.name) ?? 1) === 0 ? 1 : 0)
      return pool.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, MAX_OPTIONS)
    }
    // Empty box: recent enzymes, then single cutters, common ones first.
    const recent = loadRecent().map(n => pool.find(e => e.name === n)).filter((e): e is RestrictionEnzyme => !!e)
    const single = source
      ? pool.filter(e => cutCounts.get(e.name) === 1 && !recent.includes(e))
        .sort((a, b) => Number(COMMON.has(b.name)) - Number(COMMON.has(a.name)) || a.name.localeCompare(b.name))
      : []
    return [...recent, ...single].slice(0, MAX_OPTIONS)
  }, [query, value, cutCounts, source])

  /** Enzymes whose every site on this source is blocked by methylation. */
  const blocked = useMemo(() => {
    const set = new Set<string>()
    if (!source || (!source.damMethylated && !source.dcmMethylated)) return set
    for (const e of options) {
      const r = findUnblockedSites(source.bases, source.topology, [e], !!source.damMethylated, !!source.dcmMethylated)
      if (r.sites.length === 0 && r.blocked.length > 0) set.add(e.name)
    }
    return set
  }, [options, source])

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

  return (
    <div className="gw-enzyme-field">
      <div className="gw-enzyme-box" onClick={() => inputRef.current?.focus()}>
        {value.map(name => (
          <span key={name} className="gw-enzyme-chip">
            {name}
            {source && (cutCounts.get(name) ?? 0) === 0 && <span className="gw-enzyme-chip-warn" title="Does not cut this sequence">0×</span>}
            <button
              type="button"
              className="gw-enzyme-chip-x"
              aria-label={`Remove ${name}`}
              onClick={ev => { ev.stopPropagation(); onChange(value.filter(n => n !== name)) }}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="gw-enzyme-input"
          value={query}
          placeholder={value.length === 0 ? 'Uncut. Type e.g. EcoRI+BamHI' : 'Add enzyme'}
          role="combobox"
          aria-label="Enzymes"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
          onChange={e => onInput(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          onPaste={e => {
            const text = e.clipboardData.getData('text')
            if (/[\s,+;/]/.test(text.trim())) { e.preventDefault(); commitText(text) }
          }}
        />
      </div>
      {unknown.length > 0 && (
        <div className="gw-field-hint warn">Not recognised: {unknown.join(', ')}</div>
      )}
      {open && options.length > 0 && (
        <div className="gw-enzyme-options" role="listbox" id={listId}>
          {!query.trim() && (
            <div className="gw-enzyme-options-head">{source ? 'Recent and single cutters' : 'Recent'}</div>
          )}
          {options.map((e, i) => {
            const cuts = cutCounts.get(e.name)
            return (
              <div
                key={e.name}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`gw-enzyme-option ${i === active ? 'active' : ''}`}
                onMouseDown={ev => { ev.preventDefault(); add([e.name]) }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="gw-eo-name">{e.name}</span>
                <span className="gw-eo-site">{e.recognition}</span>
                {blocked.has(e.name) && <span className="gw-eo-blocked" title="Every site is blocked by dam/dcm methylation">blocked</span>}
                {cuts !== undefined && <span className={`gw-eo-cuts ${cuts === 0 ? 'zero' : cuts === 1 ? 'one' : ''}`}>{cuts}×</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
