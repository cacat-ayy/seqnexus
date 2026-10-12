// Generates the hero strips in index.html from the pDONR221 sequence in site.js.
//
//   node assets/hero-strip.mjs wide    > wide.svg     (114 bp, desktop)
//   node assets/hero-strip.mjs narrow  > narrow.svg   (40 bp, phones)
//
// Each is one window of the kanamycin resistance gene (KanR, 3156..3965) that
// contains a restriction site found nowhere else in the plasmid, a 20-mer with
// an NGG for a guide, the primer closest to 60 C by the nearest-neighbour
// model, the real translation, and a missense SNV named as HGVS names it.
// Read depths and scores are illustrative. The layers are <g class="L L-name">
// so site.css can animate them in order. Paste the output between the
// strip-scroll div tags in index.html, keeping the class on the <svg>.
import { readFileSync } from 'node:fs'

const mode = process.argv[2] === 'narrow' ? 'narrow' : 'wide'
const NARROW = mode === 'narrow'
const W = NARROW ? 40 : 114

const js = readFileSync(new URL('../site.js', import.meta.url), 'utf8')
const SEQ = js.match(/var SEQ = '([acgt]+)'/)[1].toUpperCase()
const CDS = { s: 3156, e: 3965, name: 'KanR' }   // 1-based inclusive, forward
const CODE = {}
const B = 'TCAG'; const AA = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG'
let k = 0; for (const a of B) for (const b of B) for (const c of B) CODE[a + b + c] = AA[k++]
const AA3 = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val', '*': 'Ter' }
const ENZ = { EcoRI: 'GAATTC', BamHI: 'GGATCC', HindIII: 'AAGCTT', NcoI: 'CCATGG', XhoI: 'CTCGAG', SalI: 'GTCGAC', PstI: 'CTGCAG', KpnI: 'GGTACC', SacI: 'GAGCTC', NheI: 'GCTAGC', XbaI: 'TCTAGA', BglII: 'AGATCT', SpeI: 'ACTAGT', AgeI: 'ACCGGT', BsrGI: 'TGTACA', PvuII: 'CAGCTG', SmaI: 'CCCGGG', NdeI: 'CATATG', BspEI: 'TCCGGA', ClaI: 'ATCGAT', EcoRV: 'GATATC', MluI: 'ACGCGT', NruI: 'TCGCGA', StuI: 'AGGCCT', ScaI: 'AGTACT', BstBI: 'TTCGAA', AflII: 'CTTAAG', AvrII: 'CCTAGG', BsiWI: 'CGTACG', PmlI: 'CACGTG', SnaBI: 'TACGTA', SphI: 'GCATGC', PvuI: 'CGATCG', ApaI: 'GGGCCC', BclI: 'TGATCA' }
// top-strand cut after n bases, bottom after m, within the site
const CUT = { EcoRI: [1, 5], BamHI: [1, 5], HindIII: [1, 5], NcoI: [1, 5], XhoI: [1, 5], SalI: [1, 5], PstI: [5, 1], KpnI: [5, 1], SacI: [5, 1], NheI: [1, 5], XbaI: [1, 5], BglII: [1, 5], SpeI: [1, 5], AgeI: [1, 5], BsrGI: [1, 5], PvuII: [3, 3], SmaI: [3, 3], NdeI: [2, 4], BspEI: [1, 5], ClaI: [2, 4], EcoRV: [3, 3], MluI: [1, 5], NruI: [3, 3], StuI: [3, 3], ScaI: [3, 3], BstBI: [2, 4], AflII: [1, 5], AvrII: [1, 5], BsiWI: [1, 5], PmlI: [3, 3], SnaBI: [3, 3], SphI: [5, 1], PvuI: [4, 2], ApaI: [5, 1], BclI: [1, 5] }
const comp = s => s.replace(/./g, c => ({ A: 'T', C: 'G', G: 'C', T: 'A' }[c]))

// SantaLucia 1998 nearest neighbour, 50 mM Na, 250 nM oligo
const NN = { AA: [-7.9, -22.2], TT: [-7.9, -22.2], AT: [-7.2, -20.4], TA: [-7.2, -21.3], CA: [-8.5, -22.7], TG: [-8.5, -22.7], GT: [-8.4, -22.4], AC: [-8.4, -22.4], CT: [-7.8, -21.0], AG: [-7.8, -21.0], GA: [-8.2, -22.2], TC: [-8.2, -22.2], CG: [-10.6, -27.2], GC: [-9.8, -24.4], GG: [-8.0, -19.9], CC: [-8.0, -19.9] }
function tm(s) {
  let dH = 0.2, dS = -5.7
  for (let i = 0; i < s.length - 1; i++) { const [h, ss] = NN[s.slice(i, i + 2)]; dH += h; dS += ss }
  for (const end of [s[0], s[s.length - 1]]) if (end === 'A' || end === 'T') { dH += 2.2; dS += 6.9 }
  const R = 1.987, C = 250e-9, Na = 0.05
  dS += 0.368 * (s.length - 1) * Math.log(Na)
  return dH * 1000 / (dS + R * Math.log(C / 4)) - 273.15
}

// ---- choose a window -------------------------------------------------------
// Wide: the site in the middle third, primer left of it, guide anywhere clear
// of it, variant in the right third. Narrow: everything has to share 40 bp,
// so the primer and guide may run over the site (they sit on their own rows)
// and only the cuts and the variant have to stay clear of each other.
function findGuide(win, siteIdx, from, to) {
  for (let i = to; i >= from; i--) {
    if (i + 23 > W) continue
    if (win[i + 21] !== 'G' || win[i + 22] !== 'G') continue
    const cut = i + 17
    if (NARROW) { if (cut >= siteIdx - 1 && cut <= siteIdx + 6) continue }
    else if (!(i + 23 <= siteIdx || i >= siteIdx + 6)) continue
    return i
  }
  return -1
}
function findVariant(win, start, siteIdx, guideCut, from, to) {
  for (let i = from; i < to; i++) {
    const cpos = i % 3
    if (cpos === 2) continue
    if (i >= siteIdx && i < siteIdx + 6) continue
    if (NARROW && Math.abs(i - guideCut) < 2) continue
    const cs = i - cpos; const codon = win.slice(cs, cs + 3); const ref = win[i]
    for (const alt of 'ACGT') {
      if (alt === ref) continue
      const mut = codon.slice(0, cpos) + alt + codon.slice(cpos + 1)
      if (CODE[mut] !== CODE[codon] && CODE[mut] !== '*') return { i, ref, alt, codon, mut, aaRef: CODE[codon], aaAlt: CODE[mut], cNum: start + i - CDS.s + 1 }
    }
  }
  return null
}
const cands = []
for (let start = CDS.s + 30; start + W < CDS.e - 30; start += 3) {
  const win = SEQ.slice(start - 1, start - 1 + W)
  for (const [name, site] of Object.entries(ENZ)) {
    const i = win.indexOf(site)
    if (NARROW ? (i < 12 || i > W - 12) : (i < 30 || i > W - 40)) continue
    if (SEQ.split(site).length - 1 !== 1) continue
    const stagger = CUT[name][0] !== CUT[name][1]
    const gi = findGuide(win, i, 0, W - 23)
    if (gi < 0) continue
    const v = findVariant(win, start, i, gi + 17, Math.floor(W * (NARROW ? 0.55 : 0.62)), W - (NARROW ? 3 : 6))
    if (!v) continue
    cands.push({ start, win, enz: name, site, siteIdx: i, stagger, gi, v })
  }
}
const pick = cands.find(c => c.stagger) || cands[0]
if (!pick) throw new Error('no window')
const { start, win, enz, site, siteIdx, gi, v } = pick
const guide = { i: gi }
v.pNum = Math.floor((start + v.i - CDS.s) / 3) + 1
const hgvs = { c: `c.${v.cNum}${v.ref}>${v.alt}`, p: `p.(${AA3[v.aaRef]}${v.pNum}${AA3[v.aaAlt]})` }
const altCls = { A: 'a', C: 'c', G: 'g', T: 't' }[v.alt]

let pi = 0, primer = '', best = 1e9
const primerEnd = NARROW ? W : siteIdx - 2
for (let i = 0; i + 20 <= primerEnd; i++) for (const len of [20, 21, 22]) {
  if (i + len > primerEnd) continue
  const s = win.slice(i, i + len); const d = Math.abs(tm(s) - 60)
  if (d < best) { best = d; pi = i; primer = s }
}
const primerTm = tm(primer)

// ---- draw ---------------------------------------------------------------------
const cw = 11.5, x0 = 24, fs = 12
const X = i => x0 + i * cw, XC = i => x0 + (i + 0.5) * cw
const H = 332, WIDTH = x0 * 2 + W * cw
const o = []
// A label that would run past the right edge is anchored to its right end
// instead, so it reads leftwards from its mark. The length estimate is the
// monospace advance at 10.5px with the letterspacing.
const lab = (x, y, name, rest, cls = 'pop', pad = 0, anchor = 'auto') => {
  const est = (name.length + 2 + rest.replace(/&gt;/g, '>').length) * 6.95
  const right = anchor === 'end' || (anchor === 'auto' && x + pad + est > WIDTH - 8)
  return `<text class="s-lab ${cls}" x="${(x + (right ? -pad : pad)).toFixed(1)}" y="${y}"${right ? ' text-anchor="end"' : ''}><tspan class="s-name">${name}</tspan>  ${rest}</text>`
}
o.push(`<svg class="strip strip-${mode}" viewBox="0 0 ${WIDTH.toFixed(0)} ${H}" width="${WIDTH.toFixed(0)}" height="${H}" role="img" aria-label="A stretch of the kanamycin resistance gene of pDONR221 with a guide RNA, a primer, a ${enz} site, the translated reading frame, a called variant and read coverage">`)
o.push(`<style>
.s-base{font-family:var(--mono);font-size:${fs}px;text-anchor:middle;font-weight:500}
.s-comp{font-family:var(--mono);font-size:${fs}px;text-anchor:middle;fill:var(--faint)}
.s-aa{font-family:var(--mono);font-size:10px;text-anchor:middle;fill:var(--ink-2)}
.s-pos{font-family:var(--mono);font-size:9.5px;fill:var(--faint);text-anchor:middle;letter-spacing:.04em}
.s-lab{font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;fill:var(--muted)}
.s-name{font-family:var(--mono);font-size:10.5px;font-weight:600;fill:var(--ink)}
.s-rule{stroke:var(--rule-2);stroke-width:1;fill:none}
.s-tick{stroke:var(--rule-2);stroke-width:1}
.A{fill:var(--base-a)}.C{fill:var(--base-c)}.G{fill:var(--base-g)}.T{fill:var(--base-t)}
.s-primer{fill:var(--pl-pbind)}
.s-guide{fill:none;stroke:var(--pl-term);stroke-width:1.5}
.s-pam{fill:var(--pl-term);fill-opacity:.18}
.s-cut{stroke:var(--ink);stroke-width:1.25;fill:none}
.s-cds{fill:var(--accent);fill-opacity:.16;stroke:var(--accent);stroke-width:1}
.s-var{fill:var(--base-${altCls});fill-opacity:.14}
.s-cov{fill:var(--accent);fill-opacity:.22}
.s-covline{stroke:var(--accent);stroke-width:1.25;fill:none}
.s-read{fill:var(--rule-2)}
.s-read-rev{fill:var(--rule)}
.s-mm{fill:var(--base-${altCls})}
.s-lead{stroke:var(--rule-2);stroke-width:1;fill:none}
</style>`)
const yGuideLab = 16, yGuide = 30, yPrimer = 52, yRuler = 80, yTop = 104, yBot = 121, yCds = 140, yAa = 166, yVarLab = 196, yCov = 222, covH = 40, yReads = 274

// 1. ruler
o.push(`<g class="L L-ruler">`)
o.push(`<path class="s-rule" d="M${x0} ${yRuler}H${(x0 + W * cw).toFixed(1)}"/>`)
for (let i = 0; i < W; i++) {
  const pos = start + i
  if (pos % 10 === 0) { o.push(`<line class="s-tick" x1="${XC(i).toFixed(1)}" x2="${XC(i).toFixed(1)}" y1="${yRuler}" y2="${yRuler + 5}"/>`); o.push(`<text class="s-pos" x="${XC(i).toFixed(1)}" y="${yRuler - 5}">${pos.toLocaleString('en-US')}</text>`) }
}
o.push(`</g>`)

// 2. sequence, one element per base so it can type in
o.push(`<g class="L L-seq">`)
for (let i = 0; i < W; i++) {
  const b = win[i]
  o.push(`<text class="s-base ${b}" style="--i:${i}" x="${XC(i).toFixed(1)}" y="${yTop}">${b}</text>`)
  o.push(`<text class="s-comp" style="--i:${i}" x="${XC(i).toFixed(1)}" y="${yBot}">${comp(b)}</text>`)
}
o.push(`</g>`)

// 3. CDS arrow and translation
{
  const x1 = x0, x2 = x0 + W * cw
  o.push(`<g class="L L-cds">`)
  o.push(`<path class="s-cds grow" d="M${x1} ${yCds}H${(x2 - 10).toFixed(1)}L${x2.toFixed(1)} ${yCds + 7}L${(x2 - 10).toFixed(1)} ${yCds + 14}H${x1}Z"/>`)
  const aaCount = Math.floor((CDS.e - CDS.s + 1) / 3) - 1
  o.push(`<text class="s-lab pop" x="${x0 + 8}" y="${yCds + 11}"><tspan class="s-name">${CDS.name}</tspan>  ${NARROW ? `CDS · ${aaCount} aa` : `CDS ${CDS.s.toLocaleString('en-US')}..${CDS.e.toLocaleString('en-US')} · aminoglycoside phosphotransferase · ${aaCount} aa`}</text>`)
  o.push(`</g><g class="L L-aa">`)
  for (let c = 0; c + 3 <= W; c += 3) {
    o.push(`<g style="--i:${c / 3}">`)
    o.push(`<text class="s-aa" x="${XC(c + 1).toFixed(1)}" y="${yAa}">${CODE[win.slice(c, c + 3)]}</text>`)
    if (c > 0) o.push(`<line class="s-tick" x1="${X(c).toFixed(1)}" x2="${X(c).toFixed(1)}" y1="${yAa - 10}" y2="${yAa + 3}" opacity=".6"/>`)
    o.push(`</g>`)
  }
  o.push(`</g>`)
}

// 4. restriction site
{
  const [t, b] = CUT[enz]
  const xt = X(siteIdx + t), xb = X(siteIdx + b)
  const kind = t < b ? "5' overhang" : t > b ? "3' overhang" : 'blunt'
  o.push(`<g class="L L-site">`)
  o.push(`<path class="s-cut draw" pathLength="1" d="M${xt.toFixed(1)} ${yTop - fs - 2}V${yTop + 4}H${xb.toFixed(1)}V${yBot + 4}"/>`)
  // Narrow: the primer may run over the site on the row above, so the site
  // label sits to the left of its cut, reading up to the top-strand cut line.
  if (NARROW) o.push(lab(xt, yRuler - 18, enz, `cuts once · ${kind}`, 'pop', 4, 'end'))
  else o.push(lab(X(siteIdx), yRuler - 18, enz, `${site} · cuts once · ${kind}`))
  o.push(`</g>`)
}

// 5. primer
{
  const x1 = X(pi), x2 = X(pi + primer.length)
  o.push(`<g class="L L-primer">`)
  o.push(`<path class="s-primer grow" d="M${x1.toFixed(1)} ${yPrimer}H${(x2 - 6).toFixed(1)}L${x2.toFixed(1)} ${yPrimer + 5}L${(x2 - 6).toFixed(1)} ${yPrimer + 10}H${x1.toFixed(1)}Z"/>`)
  const gc = (primer.replace(/[AT]/g, '').length / primer.length * 100).toFixed(0)
  o.push(lab(x1, yPrimer - 6, 'KanR_fwd', NARROW ? `Tm ${primerTm.toFixed(1)} °C · ${gc} % GC` : `Tm ${primerTm.toFixed(1)} °C · ${gc} % GC · no hairpin`))
  o.push(`</g>`)
}

// 6. guide
{
  const cut = gi + 17
  o.push(`<g class="L L-guide">`)
  o.push(`<rect class="s-pam pop" x="${X(gi + 20).toFixed(1)}" y="${yTop - fs}" width="${(3 * cw).toFixed(1)}" height="${fs + 4}" rx="2"/>`)
  o.push(`<path class="s-guide draw" pathLength="1" d="M${X(gi).toFixed(1)} ${yGuide + 8}V${yGuide}H${X(gi + 20).toFixed(1)}V${yGuide + 8}"/>`)
  o.push(`<path class="s-cut draw late" pathLength="1" d="M${X(cut).toFixed(1)} ${yTop - fs - 2}V${yBot + 4}"/>`)
  o.push(lab(X(gi), yGuideLab, 'sgRNA 3', NARROW ? `SpCas9 · PAM ${win.slice(gi + 20, gi + 23)} · on-target 71` : `SpCas9 · PAM ${win.slice(gi + 20, gi + 23)} · on-target 71 · no off-targets at 3 mismatches`))
  o.push(`</g>`)
}

// 7. coverage
{
  const pts = []
  for (let i = 0; i <= W; i++) {
    const t = i / W
    const d = 0.72 + 0.18 * Math.sin(t * 6.1) + 0.08 * Math.sin(t * 17.3 + 1) + 0.04 * Math.sin(t * 41 + 2)
    pts.push([X(i), yCov + covH - d * covH])
  }
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('')
  o.push(`<g class="L L-cov">`)
  o.push(`<g class="wipe"><path class="s-cov" d="${line}V${yCov + covH}H${x0}Z"/><path class="s-covline" d="${line}"/></g>`)
  o.push(`<text class="s-lab pop" x="${x0}" y="${yCov - 2}"><tspan class="s-name">coverage</tspan>  ${NARROW ? '412×' : '412× mean · 2 × 150 bp paired'}</text>`)
  o.push(`</g>`)
}

// 8. reads, then the mismatches, then the variant call
{
  let seed = 7
  const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647 }
  const reads = [], mms = []
  for (let r = 0; r < 7; r++) {
    const y = yReads + r * 8
    let x = -rnd() * 40
    while (x < W) {
      const len = (NARROW ? 10 : 24) + rnd() * (NARROW ? 14 : 34), gap = 1.2 + rnd() * 3
      const a = Math.max(0, x), b = Math.min(W, x + len)
      if (b > a + 2) {
        reads.push(`<rect class="${rnd() < 0.5 ? 's-read' : 's-read-rev'}" style="--i:${r}" x="${X(a).toFixed(1)}" y="${y}" width="${((b - a) * cw).toFixed(1)}" height="5" rx="1"/>`)
        if (a <= v.i && v.i + 1 <= b && rnd() < 0.96) mms.push(`<rect class="s-mm" style="--i:${r}" x="${X(v.i).toFixed(1)}" y="${y}" width="${cw.toFixed(1)}" height="5" rx="1"/>`)
      }
      x += len + gap
    }
  }
  o.push(`<g class="L L-reads">${reads.join('')}</g>`)
  o.push(`<g class="L L-mm">${mms.join('')}</g>`)
  const xc = XC(v.i)
  o.push(`<g class="L L-var">`)
  o.push(`<rect class="s-var pop" x="${X(v.i).toFixed(1)}" y="${yRuler - 10}" width="${cw}" height="${yAa + 8 - (yRuler - 10)}" rx="2"/>`)
  o.push(`<path class="s-lead draw" pathLength="1" d="M${xc.toFixed(1)} ${yAa + 8}V${yVarLab - 4}"/>`)
  o.push(lab(xc, yVarLab, hgvs.c, NARROW ? `${hgvs.p} · 96 % of reads` : `${hgvs.p} · missense · ${v.ref}&gt;${v.alt} in 397 of 412 reads · 96 %`, 'pop', 6))
  o.push(`</g>`)
}
o.push('</svg>')
console.log(o.join('\n'))
console.error(JSON.stringify({ mode, start, end: start + W - 1, enz, siteIdx, guide, primer, primerTm: primerTm.toFixed(1), hgvs, WIDTH }))
