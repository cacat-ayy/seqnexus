/**
 * Clone verification: does a construct's sequencing confirm it?
 *
 * Given reads mapped to the designed construct, every feature of interest
 * is checked for coverage (how much of it the reads cover, optionally on
 * both strands) and for differences (positions where most reads disagree
 * with the design, with what that does to a protein). The verdict is
 * "Verified" only when every feature checked is fully covered and matches.
 */

import { callVariants, referenceIndex, type RefFeature, type Variant } from './variants'
import type { ContigDoc } from './types'

export interface VerifySettings {
  /** Reads needed over a base for it to count as covered. */
  minDepth: number
  /** Also need a forward and a reverse read over it. */
  bothStrands: boolean
  /** Features to check; null checks every feature except "source". */
  featureIds: string[] | null
}

export const DEFAULT_VERIFY: VerifySettings = { minDepth: 1, bothStrands: false, featureIds: null }

export type VerifyStatus = 'verified' | 'differences' | 'incomplete'

export interface FeatureCheck {
  feature: RefFeature
  length: number
  /** Share of the feature's bases that are covered. */
  covered: number
  /** Share covered by reads on both strands. */
  bothStrands: number
  minDepth: number
  differences: Variant[]
  status: VerifyStatus
}

export interface VerifyReport {
  verdict: VerifyStatus
  reference: { name: string; length: number; circular: boolean }
  reads: number
  covered: number
  bothStrands: number
  /** Stretches of the reference that are not covered, 1-based inclusive. */
  uncovered: { from: number; to: number }[]
  /** Every position where the consensus of the reads differs from the design. */
  differences: Variant[]
  features: FeatureCheck[]
  settings: VerifySettings
}

export function verifyClone(doc: ContigDoc, consensus: string, features: readonly RefFeature[], s: VerifySettings): VerifyReport | null {
  if (!doc.reference) return null
  const L = doc.reference.length
  const refIdx = referenceIndex(doc)
  const depth = new Uint16Array(L)
  const fwd = new Uint8Array(L)
  const rev = new Uint8Array(L)
  for (const r of doc.rows) {
    for (let k = 0; k < r.seq.length; k++) {
      const p = refIdx[r.start + k]
      if (p < 0) continue
      depth[p] = Math.min(65535, depth[p] + 1)
      if (r.reversed) rev[p] = 1
      else fwd[p] = 1
    }
  }
  const ok = (p: number) => depth[p] >= s.minDepth && (!s.bothStrands || (fwd[p] && rev[p]))
  let covered = 0
  let both = 0
  const uncovered: { from: number; to: number }[] = []
  for (let p = 0; p < L; p++) {
    if (ok(p)) covered++
    else if (uncovered.length && uncovered[uncovered.length - 1].to === p) uncovered[uncovered.length - 1].to = p + 1
    else uncovered.push({ from: p + 1, to: p + 1 })
    if (fwd[p] && rev[p]) both++
  }

  // Differences: what most reads say, whatever the quality (low-confidence ones are flagged by their P-value).
  const differences = callVariants(doc, consensus, features, {
    minCoverage: 1, minFrequency: 0.5, maxPValue: 1, codingOnly: false, excludeStrandBias: false,
  })

  const chosen = features.filter(f => (s.featureIds ? s.featureIds.includes(f.id) : f.type !== 'source'))
  const checks: FeatureCheck[] = chosen.map(f => {
    const positions = featurePositions(f, L)
    let cov = 0
    let bs = 0
    let min = Infinity
    for (const p of positions) {
      if (ok(p)) cov++
      if (fwd[p] && rev[p]) bs++
      if (depth[p] < min) min = depth[p]
    }
    const n = positions.length || 1
    const diffs = differences.filter(v => v.features.includes(f.name) && overlaps(f, v, L))
    const status: VerifyStatus = diffs.length ? 'differences' : cov < positions.length ? 'incomplete' : 'verified'
    return { feature: f, length: positions.length, covered: cov / n, bothStrands: bs / n, minDepth: Number.isFinite(min) ? min : 0, differences: diffs, status }
  })

  let verdict: VerifyStatus
  if (checks.length > 0) {
    verdict = checks.some(c => c.status === 'differences') ? 'differences' : checks.some(c => c.status === 'incomplete') ? 'incomplete' : 'verified'
  } else {
    verdict = differences.length ? 'differences' : covered < L ? 'incomplete' : 'verified'
  }

  return {
    verdict,
    reference: { name: doc.reference.name, length: L, circular: doc.reference.circular },
    reads: doc.rows.length,
    covered: L ? covered / L : 0,
    bothStrands: L ? both / L : 0,
    uncovered,
    differences,
    features: checks,
    settings: s,
  }
}

function featurePositions(f: RefFeature, L: number): number[] {
  const out: number[] = []
  if (f.start <= f.end) for (let p = f.start; p < Math.min(f.end, L); p++) out.push(p)
  else { for (let p = f.start; p < L; p++) out.push(p); for (let p = 0; p < f.end; p++) out.push(p) }
  return out
}

function overlaps(f: RefFeature, v: Variant, L: number): boolean {
  const p = v.position - 1
  const inside = (x: number) => (f.start <= f.end ? x >= f.start && x < f.end : x >= f.start || x < f.end)
  void L
  return inside(p) || (v.type === 'Insertion' && inside(p + 1))
}

export const STATUS_LABEL: Record<VerifyStatus, string> = {
  verified: 'Verified',
  differences: 'Differences found',
  incomplete: 'Not fully covered',
}

const pct = (x: number) => `${(x * 100).toFixed(x === 1 || x === 0 ? 0 : 1)}%`

/** The report as CSV: one row per feature, then one per difference. */
export function verifyCsv(r: VerifyReport): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines = [
    `Clone verification,${q(r.reference.name)},${STATUS_LABEL[r.verdict]}`,
    `Reads,${r.reads}`,
    `Covered,${pct(r.covered)}`,
    `Both strands,${pct(r.bothStrands)}`,
    '',
    'Feature,Type,Status,Length,Covered,Both strands,Lowest depth,Differences',
    ...r.features.map(f => [f.feature.name, f.feature.type, STATUS_LABEL[f.status], String(f.length), pct(f.covered), pct(f.bothStrands), String(f.minDepth), f.differences.map(describeDifference).join('; ')].map(q).join(',')),
    '',
    'Position,Change,Frequency,Coverage,P-value,Features,Protein change,Effect',
    ...r.differences.map(v => [String(v.position), describeChange(v), v.frequency.toFixed(2), String(v.coverage), v.pValue.toExponential(1), v.features.join('; '), v.coding?.protein ?? '', v.coding?.effect ?? ''].map(q).join(',')),
  ]
  return lines.join('\n') + '\n'
}

export function describeChange(v: Variant): string {
  if (v.type === 'SNP') return `${v.ref}>${v.alt}`
  return v.type === 'Insertion' ? `ins ${v.alt}` : `del ${v.ref}`
}

export function describeDifference(v: Variant): string {
  return `${v.position} ${describeChange(v)}${v.coding ? ` (${v.coding.protein}, ${v.coding.effect.toLowerCase()})` : ''}`
}

/** A self-contained HTML page of the report, for printing to PDF. */
export function verifyHtml(r: VerifyReport, contigName: string, date = new Date()): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const colour = { verified: '#15803d', differences: '#b91c1c', incomplete: '#b45309' }[r.verdict]
  const featureRows = r.features.map(f => `<tr><td>${esc(f.feature.name)}</td><td>${esc(f.feature.type)}</td><td style="color:${{ verified: '#15803d', differences: '#b91c1c', incomplete: '#b45309' }[f.status]}">${STATUS_LABEL[f.status]}</td><td class="n">${f.length}</td><td class="n">${pct(f.covered)}</td><td class="n">${pct(f.bothStrands)}</td><td class="n">${f.minDepth}</td><td>${f.differences.map(d => esc(describeDifference(d))).join('<br>')}</td></tr>`).join('')
  const diffRows = r.differences.map(v => `<tr><td class="n">${v.position}</td><td>${esc(describeChange(v))}</td><td class="n">${Math.round(v.frequency * 100)}%</td><td class="n">${v.coverage}</td><td class="n">${v.pValue.toExponential(1)}</td><td>${esc(v.features.join(', '))}</td><td>${esc(v.coding ? `${v.coding.protein} (${v.coding.effect})` : '')}</td></tr>`).join('')
  const gaps = r.uncovered.map(g => (g.from === g.to ? `${g.from}` : `${g.from}–${g.to}`)).join(', ')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(contigName)}: clone verification</title><style>
body{font:13px/1.45 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937;margin:24px}
h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 6px}
.verdict{display:inline-block;padding:4px 10px;border-radius:6px;font-weight:700;color:#fff;background:${colour}}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{border-bottom:1px solid #e5e7eb;padding:4px 6px;text-align:left;vertical-align:top}
th{color:#6b7280;font-weight:600}.n{text-align:right;font-variant-numeric:tabular-nums}.muted{color:#6b7280}
</style></head><body>
<h1>${esc(r.reference.name)}</h1>
<div class="muted">${esc(contigName)} · ${r.reads} reads · ${date.toISOString().slice(0, 10)}</div>
<p><span class="verdict">${STATUS_LABEL[r.verdict]}</span></p>
<p>${pct(r.covered)} of ${r.reference.length.toLocaleString()} bp covered${r.settings.minDepth > 1 ? ` by at least ${r.settings.minDepth} reads` : ''}${r.settings.bothStrands ? ' on both strands' : ''}; ${pct(r.bothStrands)} on both strands. ${r.differences.length ? `${r.differences.length} difference${r.differences.length === 1 ? '' : 's'} from the design.` : 'No differences from the design.'}</p>
${gaps ? `<p class="muted">Not covered: ${gaps}</p>` : ''}
${r.features.length ? `<h2>Features</h2><table><thead><tr><th>Feature</th><th>Type</th><th>Status</th><th class="n">Length</th><th class="n">Covered</th><th class="n">Both strands</th><th class="n">Lowest depth</th><th>Differences</th></tr></thead><tbody>${featureRows}</tbody></table>` : ''}
${r.differences.length ? `<h2>Differences</h2><table><thead><tr><th class="n">Position</th><th>Change</th><th class="n">Reads</th><th class="n">Coverage</th><th class="n">P-value</th><th>Features</th><th>Protein</th></tr></thead><tbody>${diffRows}</tbody></table>` : ''}
</body></html>`
}
