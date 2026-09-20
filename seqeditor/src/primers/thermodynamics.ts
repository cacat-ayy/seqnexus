/**
 * Nearest-neighbor thermodynamic parameters and Tm calculation.
 *
 * Uses the unified SantaLucia (1998) nearest-neighbor parameters for
 * DNA/DNA duplexes. Salt correction uses the Owczarzy et al. (2004)
 * monovalent cation formula.
 *
 * Reference:
 *   SantaLucia J Jr. (1998) "A unified view of polymer, dumbbell, and
 *   oligonucleotide DNA nearest-neighbor thermodynamics."
 *   Proc Natl Acad Sci USA 95:1460-1465.
 *
 *   Owczarzy R et al. (2004) "Effects of sodium ions on DNA duplex
 *   oligomers." Biochemistry 43:3537-3554.
 */

// ---------------------------------------------------------------------------
// Nearest-neighbor parameters: ΔH (cal/mol) and ΔS (cal/mol·K)
// ---------------------------------------------------------------------------

/** ΔH in cal/mol for each dinucleotide pair (5'→3' / 3'→5'). */
const NN_DH: Record<string, number> = {
  'AA': -7900,  'TT': -7900,
  'AT': -7200,
  'TA': -7200,
  'CA': -8500,  'TG': -8500,
  'GT': -8400,  'AC': -8400,
  'CT': -7800,  'AG': -7800,
  'GA': -8200,  'TC': -8200,
  'CG': -10600,
  'GC': -9800,
  'GG': -8000,  'CC': -8000,
}

/** ΔS in cal/mol·K for each dinucleotide pair. */
const NN_DS: Record<string, number> = {
  'AA': -22.2,  'TT': -22.2,
  'AT': -20.4,
  'TA': -21.3,
  'CA': -22.7,  'TG': -22.7,
  'GT': -22.4,  'AC': -22.4,
  'CT': -21.0,  'AG': -21.0,
  'GA': -22.2,  'TC': -22.2,
  'CG': -27.2,
  'GC': -24.4,
  'GG': -19.9,  'CC': -19.9,
}

// Initiation parameters
const INIT_DH_GC = 100    // cal/mol - initiation with terminal G-C
const INIT_DS_GC = -2.8   // cal/mol·K
const INIT_DH_AT = 2300   // cal/mol - initiation with terminal A-T
const INIT_DS_AT = 4.1    // cal/mol·K

const R = 1.987 // gas constant cal/(mol·K)

/**
 * Compute raw ΔH and ΔS for a DNA oligo using nearest-neighbor parameters.
 * Returns { dH, dS } in cal/mol and cal/mol·K respectively.
 */
export function nnParams(seq: string): { dH: number; dS: number } {
  const s = seq.toUpperCase()
  let dH = 0
  let dS = 0

  // Initiation parameters based on terminal bases
  const first = s[0]
  const last = s[s.length - 1]

  if (first === 'G' || first === 'C') {
    dH += INIT_DH_GC; dS += INIT_DS_GC
  } else {
    dH += INIT_DH_AT; dS += INIT_DS_AT
  }
  if (last === 'G' || last === 'C') {
    dH += INIT_DH_GC; dS += INIT_DS_GC
  } else {
    dH += INIT_DH_AT; dS += INIT_DS_AT
  }

  // Sum nearest-neighbor contributions
  for (let i = 0; i < s.length - 1; i++) {
    const pair = s[i] + s[i + 1]
    const h = NN_DH[pair]
    const ds = NN_DS[pair]
    if (h !== undefined && ds !== undefined) {
      dH += h
      dS += ds
    }
  }

  return { dH, dS }
}

/**
 * Options for Tm calculation beyond the basic sequence.
 */
export interface TmOptions {
  /** Total primer/oligo concentration in nM (default 250). */
  primerConc?: number
  /** Monovalent cation (Na⁺/K⁺/Tris) concentration in mM (default 50). */
  naConc?: number
  /** Divalent cation (Mg²⁺) concentration in mM (default 0). */
  mgConc?: number
  /** dNTP concentration in mM (default 0). dNTPs chelate Mg²⁺ 1:1. */
  dntpConc?: number
}

/**
 * Calculate melting temperature (°C) using the nearest-neighbor method.
 *
 * Uses SantaLucia (1998) NN parameters with Owczarzy et al. (2004/2008)
 * salt corrections. When Mg²⁺ is provided, uses the Owczarzy (2008)
 * divalent correction with free Mg²⁺ = Mg²⁺ − dNTPs.
 *
 * @param seq     DNA sequence (A/T/G/C only).
 * @param opts    Concentration parameters (all optional with sensible defaults).
 * @returns       Tm in °C, or NaN for sequences shorter than 2 bases.
 */
export function calcTm(
  seq: string,
  optsOrPrimerConc: TmOptions | number = {},
  naConc_legacy?: number,
): number {
  if (seq.length < 2) return NaN

  // Support legacy (primerConc, naConc) positional args
  let opts: TmOptions
  if (typeof optsOrPrimerConc === 'number') {
    opts = { primerConc: optsOrPrimerConc, naConc: naConc_legacy }
  } else {
    opts = optsOrPrimerConc
  }

  const primerConc = opts.primerConc ?? 250
  const naConc = opts.naConc ?? 50
  const mgConc = opts.mgConc ?? 0
  const dntpConc = opts.dntpConc ?? 0

  const { dH, dS } = nnParams(seq)

  // Primer concentration correction: assume self-complementary is rare,
  // use Ct/4 for non-self-complementary (the common case).
  const Ct = primerConc * 1e-9 // convert nM to M

  // Base Tm at 1M NaCl
  const tm1M = dH / (dS + R * Math.log(Ct / 4)) - 273.15
  const invTm1M = 1 / (tm1M + 273.15)
  const fGC = gcFraction(seq)

  // Free Mg²⁺ after dNTP chelation (1:1 stoichiometry)
  const freeMg = Math.max(0, mgConc - dntpConc)

  // Decide which salt correction to use
  if (freeMg > 0) {
    // Owczarzy et al. (2008) - divalent cation correction
    // Simplified equation 16 for [Mg²⁺] dominant conditions
    const Mg = freeMg * 1e-3 // convert mM to M
    const lnMg = Math.log(Mg)
    const N = seq.length

    const a = 3.92e-5
    const b = -9.11e-6
    const c = 6.26e-5
    const d = 1.42e-5
    const e = -4.82e-4
    const f = 5.25e-4
    const g = 8.31e-5

    const invTmMg = invTm1M
      + a + b * lnMg + fGC * (c + d * lnMg)
      + (1 / (2 * (N - 1))) * (e + f * lnMg + g * lnMg * lnMg)

    return 1 / invTmMg - 273.15
  } else {
    // Owczarzy et al. (2004) - monovalent cation correction
    const Na = naConc * 1e-3 // convert mM to M
    const lnNa = Math.log(Na)
    const invTmNa = invTm1M
      + (4.29e-5 * fGC - 3.95e-5) * lnNa
      + 9.40e-6 * lnNa * lnNa

    return 1 / invTmNa - 273.15
  }
}

/**
 * GC fraction of a sequence (0–1).
 */
export function gcFraction(seq: string): number {
  const s = seq.toUpperCase()
  let gc = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === 'G' || s[i] === 'C') gc++
  }
  return gc / s.length
}

/**
 * GC content as a percentage (0–100).
 */
export function gcPercent(seq: string): number {
  return gcFraction(seq) * 100
}

/**
 * ΔG at 37°C in kcal/mol for a sequence (used for 3' stability checks).
 */
export function deltaG37(seq: string): number {
  const { dH, dS } = nnParams(seq)
  return (dH - (273.15 + 37) * dS) / 1000 // convert cal to kcal
}
