/**
 * CFD: the Cutting Frequency Determination score of Doench et al. 2016.
 *
 * Two fitted tables, both from supplementary table 19 of that paper and read
 * here from the authors' own distribution, not retyped: how much activity a
 * site keeps when one base of the guide meets the wrong base of the target,
 * by which of the twelve pairings it is and where along the spacer it falls,
 * and how often each PAM is bound at all. A site's score is the product of a
 * factor for every mismatch and the activity of its PAM.
 *
 * The columns count 1 to 20 from the 5' end of the spacer, which is the end
 * away from the PAM, and the keys read as the paper writes them: the guide
 * base as RNA against the complement of the base it meets in the target, so
 * rG:dT is a G in the guide sitting opposite a T on the strand the
 * protospacer is read from.
 *
 * The model is fitted for SpCas9 with a 20 base spacer and a three base PAM.
 * Nothing here extends it to another nuclease or another spacer length;
 * `offTargetModelFor` picks the position heuristic instead when the model
 * does not apply. `oracle.test.ts` checks both tables against the authors'
 * files.
 */

/** Activity left after one mismatch, by column and by pairing. */
export const CFD_MISMATCH: Readonly<Record<number, Readonly<Record<string, number>>>> = {
  1: { 'rA:dA': 1, 'rA:dC': 1, 'rA:dG': 0.857143, 'rC:dA': 1, 'rC:dC': 0.913043, 'rC:dT': 1, 'rG:dA': 1, 'rG:dG': 0.714286, 'rG:dT': 0.9, 'rU:dC': 0.956522, 'rU:dG': 0.857143, 'rU:dT': 1 },
  2: { 'rA:dA': 0.727273, 'rA:dC': 0.8, 'rA:dG': 0.785714, 'rC:dA': 0.909091, 'rC:dC': 0.695652, 'rC:dT': 0.727273, 'rG:dA': 0.636364, 'rG:dG': 0.692308, 'rG:dT': 0.846154, 'rU:dC': 0.84, 'rU:dG': 0.857143, 'rU:dT': 0.846154 },
  3: { 'rA:dA': 0.705882, 'rA:dC': 0.611111, 'rA:dG': 0.428571, 'rC:dA': 0.6875, 'rC:dC': 0.5, 'rC:dT': 0.866667, 'rG:dA': 0.5, 'rG:dG': 0.384615, 'rG:dT': 0.75, 'rU:dC': 0.5, 'rU:dG': 0.428571, 'rU:dT': 0.714286 },
  4: { 'rA:dA': 0.636364, 'rA:dC': 0.625, 'rA:dG': 0.352941, 'rC:dA': 0.8, 'rC:dC': 0.5, 'rC:dT': 0.842105, 'rG:dA': 0.363636, 'rG:dG': 0.529412, 'rG:dT': 0.9, 'rU:dC': 0.625, 'rU:dG': 0.647059, 'rU:dT': 0.47619 },
  5: { 'rA:dA': 0.363636, 'rA:dC': 0.72, 'rA:dG': 0.5, 'rC:dA': 0.636364, 'rC:dC': 0.6, 'rC:dT': 0.571429, 'rG:dA': 0.3, 'rG:dG': 0.785714, 'rG:dT': 0.866667, 'rU:dC': 0.64, 'rU:dG': 1, 'rU:dT': 0.5 },
  6: { 'rA:dA': 0.714286, 'rA:dC': 0.714286, 'rA:dG': 0.454545, 'rC:dA': 0.928571, 'rC:dC': 0.5, 'rC:dT': 0.928571, 'rG:dA': 0.666667, 'rG:dG': 0.681818, 'rG:dT': 1, 'rU:dC': 0.571429, 'rU:dG': 0.909091, 'rU:dT': 0.866667 },
  7: { 'rA:dA': 0.4375, 'rA:dC': 0.705882, 'rA:dG': 0.4375, 'rC:dA': 0.8125, 'rC:dC': 0.470588, 'rC:dT': 0.75, 'rG:dA': 0.571429, 'rG:dG': 0.6875, 'rG:dT': 1, 'rU:dC': 0.588235, 'rU:dG': 0.6875, 'rU:dT': 0.875 },
  8: { 'rA:dA': 0.428571, 'rA:dC': 0.733333, 'rA:dG': 0.428571, 'rC:dA': 0.875, 'rC:dC': 0.642857, 'rC:dT': 0.65, 'rG:dA': 0.625, 'rG:dG': 0.615385, 'rG:dT': 1, 'rU:dC': 0.733333, 'rU:dG': 1, 'rU:dT': 0.8 },
  9: { 'rA:dA': 0.6, 'rA:dC': 0.666667, 'rA:dG': 0.571429, 'rC:dA': 0.875, 'rC:dC': 0.619048, 'rC:dT': 0.857143, 'rG:dA': 0.533333, 'rG:dG': 0.538462, 'rG:dT': 0.642857, 'rU:dC': 0.619048, 'rU:dG': 0.923077, 'rU:dT': 0.928571 },
  10: { 'rA:dA': 0.882353, 'rA:dC': 0.555556, 'rA:dG': 0.333333, 'rC:dA': 0.941176, 'rC:dC': 0.388889, 'rC:dT': 0.866667, 'rG:dA': 0.8125, 'rG:dG': 0.4, 'rG:dT': 0.933333, 'rU:dC': 0.5, 'rU:dG': 0.533333, 'rU:dT': 0.857143 },
  11: { 'rA:dA': 0.307692, 'rA:dC': 0.65, 'rA:dG': 0.4, 'rC:dA': 0.307692, 'rC:dC': 0.25, 'rC:dT': 0.75, 'rG:dA': 0.384615, 'rG:dG': 0.428571, 'rG:dT': 1, 'rU:dC': 0.4, 'rU:dG': 0.666667, 'rU:dT': 0.75 },
  12: { 'rA:dA': 0.333333, 'rA:dC': 0.722222, 'rA:dG': 0.263158, 'rC:dA': 0.538462, 'rC:dC': 0.444444, 'rC:dT': 0.714286, 'rG:dA': 0.384615, 'rG:dG': 0.529412, 'rG:dT': 0.933333, 'rU:dC': 0.5, 'rU:dG': 0.947368, 'rU:dT': 0.8 },
  13: { 'rA:dA': 0.3, 'rA:dC': 0.652174, 'rA:dG': 0.210526, 'rC:dA': 0.7, 'rC:dC': 0.136364, 'rC:dT': 0.384615, 'rG:dA': 0.3, 'rG:dG': 0.421053, 'rG:dT': 0.923077, 'rU:dC': 0.26087, 'rU:dG': 0.789474, 'rU:dT': 0.692308 },
  14: { 'rA:dA': 0.533333, 'rA:dC': 0.466667, 'rA:dG': 0.214286, 'rC:dA': 0.733333, 'rC:dC': 0, 'rC:dT': 0.35, 'rG:dA': 0.266667, 'rG:dG': 0.428571, 'rG:dT': 0.75, 'rU:dC': 0, 'rU:dG': 0.285714, 'rU:dT': 0.619048 },
  15: { 'rA:dA': 0.2, 'rA:dC': 0.65, 'rA:dG': 0.272727, 'rC:dA': 0.066667, 'rC:dC': 0.05, 'rC:dT': 0.222222, 'rG:dA': 0.142857, 'rG:dG': 0.272727, 'rG:dT': 0.941176, 'rU:dC': 0.05, 'rU:dG': 0.272727, 'rU:dT': 0.578947 },
  16: { 'rA:dA': 0, 'rA:dC': 0.192308, 'rA:dG': 0, 'rC:dA': 0.307692, 'rC:dC': 0.153846, 'rC:dT': 1, 'rG:dA': 0, 'rG:dG': 0, 'rG:dT': 1, 'rU:dC': 0.346154, 'rU:dG': 0.666667, 'rU:dT': 0.909091 },
  17: { 'rA:dA': 0.133333, 'rA:dC': 0.176471, 'rA:dG': 0.176471, 'rC:dA': 0.466667, 'rC:dC': 0.058824, 'rC:dT': 0.466667, 'rG:dA': 0.25, 'rG:dG': 0.235294, 'rG:dT': 0.933333, 'rU:dC': 0.117647, 'rU:dG': 0.705882, 'rU:dT': 0.533333 },
  18: { 'rA:dA': 0.5, 'rA:dC': 0.4, 'rA:dG': 0.190476, 'rC:dA': 0.642857, 'rC:dC': 0.133333, 'rC:dT': 0.538462, 'rG:dA': 0.666667, 'rG:dG': 0.47619, 'rG:dT': 0.692308, 'rU:dC': 0.333333, 'rU:dG': 0.428571, 'rU:dT': 0.666667 },
  19: { 'rA:dA': 0.538462, 'rA:dC': 0.375, 'rA:dG': 0.206897, 'rC:dA': 0.461538, 'rC:dC': 0.125, 'rC:dT': 0.428571, 'rG:dA': 0.666667, 'rG:dG': 0.448276, 'rG:dT': 0.714286, 'rU:dC': 0.25, 'rU:dG': 0.275862, 'rU:dT': 0.285714 },
  20: { 'rA:dA': 0.6, 'rA:dC': 0.764706, 'rA:dG': 0.227273, 'rC:dA': 0.3, 'rC:dC': 0.058824, 'rC:dT': 0.5, 'rG:dA': 0.7, 'rG:dG': 0.428571, 'rG:dT': 0.9375, 'rU:dC': 0.176471, 'rU:dG': 0.090909, 'rU:dT': 0.5625 },
}

/**
 * How often each PAM is bound, relative to NGG. Keyed on the last two bases,
 * which are the two the model distinguishes. A PAM scoring zero is one the
 * measurements never saw cut.
 */
export const CFD_PAM: Readonly<Record<string, number>> = {
  AA: 0,
  AC: 0,
  AG: 0.259259,
  AT: 0,
  CA: 0,
  CC: 0,
  CG: 0.107143,
  CT: 0,
  GA: 0.069444,
  GC: 0.022222,
  GG: 1,
  GT: 0.016129,
  TA: 0,
  TC: 0,
  TG: 0.038961,
  TT: 0,
}

const AS_RNA: Record<string, string> = { A: 'A', C: 'C', G: 'G', T: 'U', U: 'U' }
const COMPLEMENT: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' }

/**
 * The factor for one mismatch, or null when the pairing or the column falls
 * outside the fitted table, which is the signal to use another model.
 *
 * `column` counts 1 to 20 from the 5' end of the spacer. `spacerBase` is the
 * guide's own base and `targetBase` the base it meets on the protospacer
 * strand.
 */
export function cfdMismatchFactor(
  column: number,
  spacerBase: string,
  targetBase: string,
): number | null {
  const row = CFD_MISMATCH[column]
  if (!row) return null
  const guide = AS_RNA[spacerBase.toUpperCase()]
  const target = COMPLEMENT[targetBase.toUpperCase()]
  if (!guide || !target) return null
  const value = row[`r${guide}:d${target}`]
  return value === undefined ? null : value
}

/** The PAM's activity, from its last two bases. An unknown PAM is not cut. */
export function cfdPamActivity(pam: string): number {
  if (pam.length < 2) return 0
  return CFD_PAM[pam.slice(-2).toUpperCase()] ?? 0
}
