/**
 * The optimizer's settings, as one serialisable object.
 *
 * Kept apart from the modal so a run survives closing it, and apart from the
 * store so the defaults and the compile step can be tested without one.
 */

import {
  ConstraintSet, MOTIF_PRESETS, motifsForEnzymeGroup, motifsForEnzymes,
  parseCustomMotifs, type ConstraintOptions, type MotifSpec,
} from './constraints'
import { DEFAULT_GENETIC_CODE_ID } from './genetic-codes'
import { DEFAULT_OPTIMIZE_OPTIONS, type CodonStrategy, type OptimizationMode } from './optimize'
import { DEFAULT_TARGET_OPTIONS, type TargetKind, type TargetOptions } from './targets'
import { DEFAULT_USAGE_TABLE_ID } from './usage-tables'

export interface CodonSettings {
  target: TargetKind
  geneticCodeId: number
  usageTableId: string
  mode: OptimizationMode
  strategy: CodonStrategy
  rareThreshold: number
  seed: number

  // Avoid
  enzymeGroups: string[]
  enzymeNames: string[]
  presetIds: string[]
  customMotifs: string
  avoidCpG: boolean

  // Advanced
  maxHomopolymerAT: number
  maxHomopolymerGC: number
  minGC: number
  maxGC: number
  gcWindow: number
  maxRepeat: number
  maxHairpinStem: number
  keepStartCodon: boolean
  keepStopCodon: boolean
  keepFirstCodons: number
  protectFeatures: boolean
}

/**
 * Defaults that do nothing surprising.
 *
 * Every constraint is off: an optimizer that quietly enforced a GC window
 * nobody asked for would be blamed for the codons it picked. The homopolymer
 * limits are the exception, set to what synthesis vendors commonly reject,
 * because a run of ten A's is a problem in every context.
 */
export const DEFAULT_CODON_SETTINGS: CodonSettings = {
  target: 'cds',
  geneticCodeId: DEFAULT_GENETIC_CODE_ID,
  usageTableId: DEFAULT_USAGE_TABLE_ID,
  mode: DEFAULT_OPTIMIZE_OPTIONS.mode,
  strategy: DEFAULT_OPTIMIZE_OPTIONS.strategy,
  rareThreshold: DEFAULT_OPTIMIZE_OPTIONS.rareThreshold,
  seed: DEFAULT_OPTIMIZE_OPTIONS.seed,

  enzymeGroups: [],
  enzymeNames: [],
  presetIds: [],
  customMotifs: '',
  avoidCpG: false,

  maxHomopolymerAT: 8,
  maxHomopolymerGC: 6,
  minGC: 0,
  maxGC: 100,
  gcWindow: 0,
  maxRepeat: 0,
  maxHairpinStem: 0,
  keepStartCodon: DEFAULT_TARGET_OPTIONS.keepStartCodon,
  keepStopCodon: DEFAULT_TARGET_OPTIONS.keepStopCodon,
  keepFirstCodons: DEFAULT_TARGET_OPTIONS.keepFirstCodons,
  protectFeatures: DEFAULT_TARGET_OPTIONS.protectFeatures,
}

/** Every motif the settings ask to avoid, deduplicated by sequence. */
export function motifsFor(settings: CodonSettings): MotifSpec[] {
  const all: MotifSpec[] = [
    ...settings.enzymeGroups.flatMap(motifsForEnzymeGroup),
    ...motifsForEnzymes(settings.enzymeNames),
    ...settings.presetIds.flatMap(id => MOTIF_PRESETS.find(p => p.id === id)?.motifs ?? []),
    ...parseCustomMotifs(settings.customMotifs),
  ]
  const seen = new Set<string>()
  return all.filter(m => {
    const key = m.sequence.toUpperCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function constraintOptionsFor(settings: CodonSettings): ConstraintOptions {
  return {
    motifs: motifsFor(settings),
    maxHomopolymerAT: settings.maxHomopolymerAT,
    maxHomopolymerGC: settings.maxHomopolymerGC,
    minGC: settings.minGC,
    maxGC: settings.maxGC,
    gcWindow: settings.gcWindow,
    maxRepeat: settings.maxRepeat,
    maxHairpinStem: settings.maxHairpinStem,
    hairpinLoopMax: 30,
    avoidCpG: settings.avoidCpG,
  }
}

export function constraintSetFor(settings: CodonSettings): ConstraintSet {
  return new ConstraintSet(constraintOptionsFor(settings))
}

export function targetOptionsFor(settings: CodonSettings): TargetOptions {
  return {
    keepStartCodon: settings.keepStartCodon,
    keepStopCodon: settings.keepStopCodon,
    keepFirstCodons: settings.keepFirstCodons,
    protectFeatures: settings.protectFeatures,
  }
}
