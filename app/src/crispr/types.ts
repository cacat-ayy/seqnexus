/**
 * The CRISPR module's shared shapes.
 *
 * A nuclease is a data record, like a restriction enzyme in `enzymes/db.ts`:
 * its PAM, which side of the protospacer the PAM sits on, the spacer lengths
 * it accepts, and where it cuts. Adding a nuclease, or letting the user
 * describe one, is a row rather than code.
 *
 * Cut geometry. Both cut offsets are distances in bases from the PAM edge of
 * the protospacer, counted into the protospacer and onward, so they do not
 * change when the spacer length does:
 *
 *   SpCas9   NGG 3' of a 20-mer, blunt 3 bases in       cut { site: 3, opposite: 3 }
 *   Cas12a   TTTV 5' of a 23-mer, staggered 18 and 23   cut { site: 18, opposite: 23 }
 *
 * `site` is the cut on the strand the protospacer is written on, `opposite`
 * the cut on the other strand. The finder turns both into sense-strand
 * coordinates (`cutTop`, `cutBottom`) the way the enzyme finder reports
 * `fwdCut` and `revCut`, so anything that draws a cut or measures a fragment
 * treats the two the same way.
 */

export type PamSide = 'threePrime' | 'fivePrime'

/** What the nuclease does to the backbone: cuts both strands, nicks one, or neither. */
export type CleaveMode = 'both' | 'site' | 'opposite' | 'none'

export type OnTargetModelId = 'heuristic-cas9' | 'none'

export interface Nuclease {
  id: string
  name: string
  /** IUPAC, written 5' to 3' on the protospacer strand. */
  pam: string
  pamSide: PamSide
  /** Spacer lengths this nuclease accepts; the first is the default. */
  spacerLengths: readonly number[]
  /** Distances from the PAM edge of the protospacer to each cut. */
  cut: { site: number; opposite: number }
  /** The end a double-strand cut leaves, as seen on the sense strand. */
  overhang: 'blunt' | '5prime' | '3prime'
  cleaves: CleaveMode
  /** Which on-target model applies; 'none' means no model is shown. */
  onTargetModel: OnTargetModelId
  /** Scaffold or crRNA family, resolved to a sequence in a later phase. */
  scaffoldId?: string
  /** Promoter whose transcript start rules apply by default. */
  promoter?: PromoterId
  /** Shown in the picker, so a user knows what they are choosing. */
  note?: string
  /** Set on a nuclease the user described rather than one that ships. */
  custom?: true
}

export type PromoterId = 'u6' | 't7' | 'none'

/**
 * A protospacer found in a sequence. Coordinates are sense-strand, 0-based,
 * ends exclusive, and wrapped into the sequence on a circular molecule.
 */
export interface GuideSite {
  nucleaseId: string
  /** Protospacer start on the sense strand. */
  start: number
  /** Protospacer end on the sense strand, exclusive. */
  end: number
  pamStart: number
  pamEnd: number
  /** 1 when the protospacer reads along the sense strand, -1 when it reads along the antisense strand. */
  strand: 1 | -1
  /** The spacer as it would be ordered, 5' to 3' on the protospacer strand. */
  spacer: string
  /** The PAM, 5' to 3' on the protospacer strand. */
  pam: string
  /** Cut on the sense strand, in sense coordinates, between base cutTop-1 and cutTop. */
  cutTop: number
  /** Cut on the antisense strand, in the same coordinate frame. */
  cutBottom: number
  /** Set on a linear sequence when the site or one of its cuts falls outside it. */
  offEnd?: true
}

/** A named problem with a spacer, shown as a chip in the candidate table. */
export interface GuideFlag {
  id: GuideFlagId
  label: string
  /** 'warn' is worth knowing, 'bad' is usually disqualifying. */
  severity: 'warn' | 'bad'
  /** One line of detail, shown on hover. */
  detail: string
}

export type GuideFlagId =
  | 'gc-low'
  | 'gc-high'
  | 'polyt'
  | 'homopolymer'
  | 'self-structure'
  | 'start-base'
  | 'off-end'
  | 'ambiguous'

/**
 * What the scorer returns for one site. The three parts stay separate: a
 * model score, the repair outlook, and the flags. Nothing blends them into
 * a single number here.
 */
export interface GuideScores {
  /** On-target model output, 0 to 100, or null when no model applies. */
  onTarget: number | null
  /** Which model produced it, so the UI can name it. */
  onTargetModel: OnTargetModelId
  /** GC fraction of the spacer, 0 to 1. */
  gc: number
  /** Out-of-frame score from the microhomology pattern, 0 to 100, or null when the flanks are unknown. */
  outOfFrame: number | null
  flags: GuideFlag[]
}

/** A site with its scores, which is what the panel lists. */
export interface GuideCandidate {
  site: GuideSite
  scores: GuideScores
}

/** Which of the sites the overlay draws. */
export type GuideDrawScope = 'all' | 'picked' | 'selected'

/** What the last scan could not do, and whether one is running. */
export interface GuideScanInfo {
  running: boolean
  /** The scan hit its site cap, so the list is not everything. */
  truncated: boolean
  /** Sites passed over because the spacer held an ambiguous base. */
  skippedAmbiguous: number
}

/**
 * A guide the user kept. The extension fields are here from the start so
 * that prime editing adds no migration later: a plain guide leaves them
 * unset.
 */
export interface GuideRecord {
  id: string
  name: string
  nucleaseId: string
  /** The spacer as ordered, 5' to 3'. */
  spacer: string
  pam: string
  /** Where it was designed, for provenance. Not a promise that it still binds there. */
  origin?: {
    documentId?: string
    documentName?: string
    start: number
    end: number
    strand: 1 | -1
  }
  /** Scores as they stood when the guide was kept. */
  scores?: GuideScores
  /** Prime editing extensions, filled in a later phase. */
  extensions?: {
    /** Primer binding site, 3' of the spacer on the pegRNA. */
    pbs?: string
    /** Reverse transcriptase template. */
    rtt?: string
    /** The nicking guide's spacer, for a PE3 strategy. */
    nickingSpacer?: string
  }
  notes?: string
  createdAt: number
}
