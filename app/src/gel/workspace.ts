/**
 * The gel workspace's own state: what is on the gel, how it was run, and how
 * it is imaged, plus loading, saving and sensible first lanes.
 *
 * Pure apart from the two storage functions, which swallow every failure: a
 * gel that cannot be saved still works for the session.
 */

import { findCutSites } from '../enzymes/finder'
import { getEnzyme } from '../enzymes/db'
import { DEFAULT_LADDER_ID, getLadder } from './ladders'
import { AGAROSE_MAX, AGAROSE_MIN, GEL_FORMATS } from './migration'
import {
  DEFAULT_CONDITIONS, DEFAULT_PCR_NG, DEFAULT_SAMPLE_NG, DEFAULT_SIZES_NG,
  type FormMix, type GelBuffer, type GelConditions, type GelFormat, type GelLane, type LaneSample,
} from './model'
import { DEFAULT_LOOK, getLook, type GelLookId } from './render/looks'
import { NO_EFFECTS, type GelEffects } from './render/raster'

export type LaneLabelMode = 'numbers' | 'names'

export interface GelDisplay {
  look: GelLookId
  /** Camera exposure in stops, -2..2. */
  exposure: number
  showDyeFronts: boolean
  /** Numbers above the wells, or the samples' names written at an angle. */
  labelMode: LaneLabelMode
  effects: GelEffects
  /** Let heavily loaded bands grow thicker. */
  massThickness: boolean
}

export const DEFAULT_DISPLAY: GelDisplay = {
  look: DEFAULT_LOOK,
  exposure: 0,
  showDyeFronts: false,
  labelMode: 'numbers',
  effects: NO_EFFECTS,
  massThickness: true,
}

export interface GelWorkspaceState {
  conditions: GelConditions
  lanes: GelLane[]
  display: GelDisplay
}

/** A real comb tops out around 20 wells. */
export const MAX_LANES = 20

let laneCounter = 0
export function newLaneId(): string {
  laneCounter += 1
  return `lane_${Date.now().toString(36)}_${laneCounter}`
}

// ---------------------------------------------------------------------------
// Form mixes offered for uncut plasmid
// ---------------------------------------------------------------------------

export const FORM_PRESETS: { id: string; label: string; forms: FormMix }[] = [
  { id: 'miniprep', label: 'Miniprep', forms: { supercoiled: 0.8, nicked: 0.17, linear: 0.03 } },
  { id: 'clean', label: 'Mostly supercoiled', forms: { supercoiled: 0.95, nicked: 0.05, linear: 0 } },
  { id: 'nicked', label: 'Nicked / aged prep', forms: { supercoiled: 0.35, nicked: 0.6, linear: 0.05 } },
]

export function formPresetId(forms: FormMix | undefined): string {
  if (!forms) return FORM_PRESETS[0].id
  const hit = FORM_PRESETS.find(p =>
    Math.abs(p.forms.supercoiled - forms.supercoiled) < 1e-6 &&
    Math.abs(p.forms.nicked - forms.nicked) < 1e-6 &&
    Math.abs(p.forms.linear - forms.linear) < 1e-6)
  return hit?.id ?? FORM_PRESETS[0].id
}

// ---------------------------------------------------------------------------
// First lanes
// ---------------------------------------------------------------------------

/** What the workspace knows about the sequence open when it starts. */
export interface ActiveSequence {
  id: string
  bases: string
  topology: 'linear' | 'circular'
  /** Enzymes shown on the sequence's map, if any. */
  shownEnzymes: string[]
}

/** Fragments smaller than this are hard to see, so a diagnostic avoids them. */
const MIN_VISIBLE_FRAGMENT = 250
/** Fragments closer in size than this ratio run together as one band. */
const MIN_SIZE_RATIO = 1.2

/** Every piece visible, and no two pieces close enough in size to merge. */
function readable(pieces: number[]): boolean {
  const sorted = [...pieces].sort((a, b) => a - b)
  if (sorted[0] < MIN_VISIBLE_FRAGMENT) return false
  return sorted.every((p, i) => i === 0 || p / sorted[i - 1] >= MIN_SIZE_RATIO)
}

/**
 * Enzymes worth a first digest lane: the ones already on the map that cut the
 * sequence exactly once, preferring a pair whose fragments are all big enough
 * to see and different enough in size to tell apart.
 */
export function suggestDigest(seq: ActiveSequence): string[] {
  const single: { name: string; cut: number }[] = []
  for (const name of seq.shownEnzymes) {
    const e = getEnzyme(name)
    if (!e) continue
    const sites = findCutSites(seq.bases, e, seq.topology)
    if (sites.length === 1) single.push({ name: e.name, cut: sites[0].fwdCut })
  }
  if (single.length === 0) return []
  const len = seq.bases.length
  for (let i = 0; i < single.length; i++) {
    for (let j = i + 1; j < single.length; j++) {
      const [lo, hi] = [single[i].cut, single[j].cut].sort((a, b) => a - b)
      const pieces = seq.topology === 'circular'
        ? [hi - lo, len - (hi - lo)]
        : [lo, hi - lo, len - hi]
      if (readable(pieces)) return [single[i].name, single[j].name]
    }
  }
  return [single[0].name]
}

export function defaultLanes(active: ActiveSequence | null): GelLane[] {
  const lanes: GelLane[] = [{ id: newLaneId(), sample: { kind: 'ladder', ladderId: DEFAULT_LADDER_ID } }]
  if (!active) {
    lanes.push({ id: newLaneId(), sample: { kind: 'empty' } })
    return lanes
  }
  lanes.push({ id: newLaneId(), sample: { kind: 'sequence', sourceId: active.id, enzymes: [], ng: DEFAULT_SAMPLE_NG } })
  const digest = suggestDigest(active)
  lanes.push({
    id: newLaneId(),
    sample: digest.length > 0
      ? { kind: 'sequence', sourceId: active.id, enzymes: digest, ng: DEFAULT_SAMPLE_NG }
      : { kind: 'empty' },
  })
  return lanes
}

/** A gel for one digest: ladder, the sequence uncut, and the sequence cut. */
export function digestWorkspace(sourceId: string, enzymes: string[]): GelWorkspaceState {
  return {
    conditions: DEFAULT_CONDITIONS,
    display: DEFAULT_DISPLAY,
    lanes: [
      { id: newLaneId(), sample: { kind: 'ladder', ladderId: DEFAULT_LADDER_ID } },
      { id: newLaneId(), sample: { kind: 'sequence', sourceId, enzymes: [], ng: DEFAULT_SAMPLE_NG } },
      { id: newLaneId(), sample: { kind: 'sequence', sourceId, enzymes, ng: DEFAULT_SAMPLE_NG } },
    ],
  }
}

export function defaultWorkspace(active: ActiveSequence | null): GelWorkspaceState {
  return { conditions: DEFAULT_CONDITIONS, lanes: defaultLanes(active), display: DEFAULT_DISPLAY }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export const WORKSPACE_STORAGE_KEY = 'seqnexus_gel_workspace'
/** The modal's lane table, before the workspace. Read once to migrate. */
export const LEGACY_GEL_KEY = 'seqnexus_gel'
export const LEGACY_DISPLAY_KEY = 'seqnexus_gel_display'

interface LegacyLane {
  type?: 'ladder' | 'digest' | 'uncut'
  ladderName?: string
  sequenceTabId?: string
  enzymeNames?: string[]
}

interface LegacyGel {
  lanes?: LegacyLane[]
  gelPct?: number
  buffer?: GelBuffer
  massIntensity?: boolean
  dyeFront?: number
}

function clamp(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
}

function sanitizeConditions(c: Partial<GelConditions> | undefined): GelConditions {
  return {
    agarosePct: clamp(c?.agarosePct, AGAROSE_MIN, AGAROSE_MAX, DEFAULT_CONDITIONS.agarosePct),
    buffer: c?.buffer === 'TBE' ? 'TBE' : 'TAE',
    format: c?.format && c.format in GEL_FORMATS ? c.format as GelFormat : DEFAULT_CONDITIONS.format,
    dyeFront: clamp(c?.dyeFront, 0.3, 1, DEFAULT_CONDITIONS.dyeFront),
  }
}

function sanitizeDisplay(d: Partial<GelDisplay> | undefined): GelDisplay {
  return {
    look: getLook(d?.look).id,
    exposure: clamp(d?.exposure, -2, 2, 0),
    showDyeFronts: !!d?.showDyeFronts,
    labelMode: d?.labelMode === 'names' ? 'names' : 'numbers',
    effects: { ...NO_EFFECTS, ...d?.effects },
    massThickness: d?.massThickness ?? true,
  }
}

function sanitizeSample(s: Partial<LaneSample> | undefined): LaneSample {
  if (s?.kind === 'ladder' && typeof s.ladderId === 'string') {
    const ladder = getLadder(s.ladderId)
    return { kind: 'ladder', ladderId: ladder?.id ?? DEFAULT_LADDER_ID, ...(typeof s.ng === 'number' ? { ng: s.ng } : {}) }
  }
  if (s?.kind === 'sequence' && typeof s.sourceId === 'string') {
    return {
      kind: 'sequence',
      sourceId: s.sourceId,
      enzymes: Array.isArray(s.enzymes) ? s.enzymes.filter(e => typeof e === 'string') : [],
      ng: clamp(s.ng, 1, 10_000, DEFAULT_SAMPLE_NG),
      ...(s.forms ? { forms: s.forms } : {}),
    }
  }
  if (s?.kind === 'pcr' && typeof s.templateId === 'string') {
    return {
      kind: 'pcr',
      templateId: s.templateId,
      forwardId: typeof s.forwardId === 'string' ? s.forwardId : '',
      reverseId: typeof s.reverseId === 'string' ? s.reverseId : '',
      ng: clamp(s.ng, 1, 10_000, DEFAULT_PCR_NG),
    }
  }
  if (s?.kind === 'sizes' && Array.isArray(s.sizes)) {
    return {
      kind: 'sizes',
      sizes: s.sizes.filter(n => typeof n === 'number' && Number.isFinite(n) && n > 0).slice(0, 50),
      ng: clamp(s.ng, 0.1, 10_000, DEFAULT_SIZES_NG),
    }
  }
  return { kind: 'empty' }
}

/**
 * Repair a stored gel: clamp numbers into range, drop unknown kinds to empty
 * wells, fill in missing ids. Null when it is not a gel at all.
 */
export function sanitizeWorkspace(raw: unknown): GelWorkspaceState | null {
  const saved = raw as Partial<GelWorkspaceState> | null
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.lanes)) return null
  return {
    conditions: sanitizeConditions(saved.conditions),
    lanes: saved.lanes.slice(0, MAX_LANES).map(l => ({
      id: typeof l?.id === 'string' ? l.id : newLaneId(),
      ...(typeof l?.label === 'string' && l.label ? { label: l.label } : {}),
      sample: sanitizeSample(l?.sample),
    })),
    display: sanitizeDisplay(saved.display),
  }
}

/** Convert the old modal's lane table to lanes. */
export function migrateLegacy(legacy: LegacyGel, displayRaw: Partial<GelDisplay> | null): GelWorkspaceState | null {
  if (!Array.isArray(legacy.lanes) || legacy.lanes.length === 0) return null
  const lanes: GelLane[] = legacy.lanes.slice(0, MAX_LANES).map(l => {
    let sample: LaneSample = { kind: 'empty' }
    if (l.type === 'ladder') {
      sample = { kind: 'ladder', ladderId: getLadder(l.ladderName ?? '')?.id ?? DEFAULT_LADDER_ID }
    } else if (l.sequenceTabId) {
      const enzymes = l.type === 'digest' ? (l.enzymeNames ?? []) : []
      // The old table left a digest lane without enzymes blank.
      sample = l.type === 'digest' && enzymes.length === 0
        ? { kind: 'empty' }
        : { kind: 'sequence', sourceId: l.sequenceTabId, enzymes, ng: DEFAULT_SAMPLE_NG }
    }
    return { id: newLaneId(), sample }
  })
  return {
    conditions: sanitizeConditions({ agarosePct: legacy.gelPct, buffer: legacy.buffer, dyeFront: legacy.dyeFront }),
    lanes,
    display: sanitizeDisplay({ ...displayRaw, massThickness: legacy.massIntensity ?? true }),
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

/**
 * The single gel kept in local storage before gels were session items, in
 * either of its two old shapes. Read once, to become the first gel item.
 */
export function loadStoredWorkspace(): GelWorkspaceState | null {
  const saved = sanitizeWorkspace(readJson(WORKSPACE_STORAGE_KEY))
  if (saved) return saved
  const legacy = readJson<LegacyGel>(LEGACY_GEL_KEY)
  return legacy ? migrateLegacy(legacy, readJson<Partial<GelDisplay>>(LEGACY_DISPLAY_KEY)) : null
}

/** Forget the local-storage gel once it lives in the session. */
export function clearStoredWorkspace(): void {
  try {
    for (const key of [WORKSPACE_STORAGE_KEY, LEGACY_GEL_KEY, LEGACY_DISPLAY_KEY]) localStorage.removeItem(key)
  } catch { /* storage blocked: nothing to clear */ }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Short ladder names for lane labels: "1 kb DNA Ladder" → "1 kb". */
export function shortLadderName(ladderId: string): string {
  const ladder = getLadder(ladderId)
  if (!ladder) return 'Ladder'
  return ladder.name.replace(/ (DNA )?(Ladder|Marker)$/i, '')
}

/** Names of what a lane refers to; null when it is gone. */
export interface NameLookup {
  sequence: (id: string) => string | null
  oligo?: (id: string) => string | null
}

/** A lane's name when it has no label of its own. */
export function autoLaneLabel(sample: LaneSample, names: NameLookup | ((id: string) => string | null)): string {
  const lookup: NameLookup = typeof names === 'function' ? { sequence: names } : names
  switch (sample.kind) {
    case 'empty': return 'Empty'
    case 'ladder': return shortLadderName(sample.ladderId)
    case 'sequence': {
      const name = lookup.sequence(sample.sourceId) ?? 'Missing'
      return sample.enzymes.length > 0 ? `${name} ${sample.enzymes.join('+')}` : `${name} uncut`
    }
    case 'pcr': {
      const fwd = lookup.oligo?.(sample.forwardId) ?? '?'
      const rev = lookup.oligo?.(sample.reverseId) ?? '?'
      return `PCR ${fwd}–${rev}`
    }
    case 'sizes': return 'Sizes'
  }
}
