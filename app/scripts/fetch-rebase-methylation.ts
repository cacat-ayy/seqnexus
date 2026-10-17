/**
 * Fetch REBASE's Dam and Dcm methylation verdicts for the enzyme database.
 *
 * Usage: npx tsx scripts/fetch-rebase-methylation.ts   (needs the network, takes a few minutes)
 * Output: scripts/data/rebase-methylation.json, read by build-enzyme-db.ts
 *
 * For each enzyme whose site a Dam (GATC) or Dcm (CCWGG) methylation can
 * reach, it reads REBASE's "Effects of overlapping methylation" summary
 * (rebase.neb.com/cgi-bin/damlist?e<name>). Where the summary is blank it
 * reads the detailed methylation-sensitivity records (cgi-bin/msget?<name>)
 * and takes the rows tested on Dam- or Dcm-methylated DNA, the verdict being
 * the column the site is printed in (cut, impaired, not cut).
 *
 * REBASE's verdicts map onto the database's like this:
 *   blocked                                    -> blocked
 *   impaired, some blocked, some impaired,
 *   variable                                   -> impaired (still cuts, with a warning)
 *   cut                                        -> insensitive
 * "Some blocked" is blocked only for some overlapping combinations; the app
 * checks that a methylated base falls inside the site, not which
 * combination, so it warns rather than removing the cut.
 */

import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { ENZYME_DB } from '../src/enzymes/db'
import { IUPAC } from '../src/models/iupac'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outputPath = join(__dirname, 'data', 'rebase-methylation.json')

type Verdict = 'blocked' | 'impaired' | 'insensitive'
type Kind = 'dam' | 'dcm'

/** Whether a methylated base of the motif can fall inside the site (the same test as db.test.ts). */
function motifCanReachSite(site: string, motif: string, methylated: number[]): boolean {
  const compatible = (a: string, b: string) => [...IUPAC[a]].some(x => IUPAC[b].includes(x))
  for (let m = -motif.length + 1; m < site.length; m++) {
    if (!methylated.some(o => m + o >= 0 && m + o < site.length)) continue
    let ok = true
    for (let i = 0; i < motif.length && ok; i++) {
      const p = m + i
      if (p >= 0 && p < site.length) ok = compatible(motif[i], site[p].toUpperCase())
    }
    if (ok) return true
  }
  return false
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function get(url: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'SeqNexus enzyme database build' } })
      if (res.ok) return await res.text()
    } catch { /* retry */ }
    await sleep(2000)
  }
  return ''
}

function fromSummaryWord(word: string): Verdict | null {
  const w = word.trim().toLowerCase()
  if (w === 'blocked') return 'blocked'
  if (['impaired', 'some blocked', 'some impaired', 'variable'].includes(w)) return 'impaired'
  if (w === 'cut') return 'insensitive'
  return null
}

/** The summary's verdicts, in its column order Dam, Dcm, CpG, EcoBI, EcoKI. */
function readSummary(page: string): Partial<Record<Kind, Verdict>> {
  const m = page.match(/overlaps\?<\/b>([\s\S]*?)<\/tr>[\s\S]*?sensitivity\?<\/b>([\s\S]*?)<\/tr>/)
  if (!m) return {}
  const cells = (s: string) => [...s.matchAll(/<td><font size=1>(.*?)<\/font><\/td>/g)].map(x => x[1])
  const overlaps = cells(m[1])
  const verdicts = cells(m[2])
  const out: Partial<Record<Kind, Verdict>> = {}
  ;(['dam', 'dcm'] as Kind[]).forEach((kind, i) => {
    const v = overlaps[i] === 'y' ? fromSummaryWord(verdicts[i] ?? '') : null
    if (v) out[kind] = v
  })
  return out
}

/** Verdicts from the detailed records tested on Dam- or Dcm-methylated DNA; the worst one wins. */
function readRecords(page: string): Partial<Record<Kind, Verdict>> {
  const rank: Record<Verdict, number> = { insensitive: 0, impaired: 1, blocked: 2 }
  const out: Partial<Record<Kind, Verdict>> = {}
  for (const row of page.matchAll(/<tr>\s*<td><font size=2>\d+<\/font><\/td>([\s\S]*?)<\/tr>/g)) {
    const pre = row[1].match(/<pre><b>([\s\S]*?)<\/b><\/pre>/)
    if (!pre) continue
    const comment = row[1].split('</pre>').pop()!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    const baseLine = pre[1].replace(/<[^>]+>/g, '').split('\n').find(l => /[ACGTU] [ACGTU]/.test(l))
    if (!baseLine) continue
    // The site is printed in one of three columns: cut, impaired, not cut.
    const column = baseLine.length - baseLine.trimStart().length
    const verdict: Verdict = column < 20 ? 'insensitive' : column < 40 ? 'impaired' : 'blocked'
    for (const kind of ['dam', 'dcm'] as Kind[]) {
      if (!new RegExp(`\\b${kind}\\b`, 'i').test(comment) || /overlapping M\./.test(comment)) continue
      const prev = out[kind]
      if (!prev || rank[verdict] > rank[prev]) out[kind] = verdict
    }
  }
  return out
}

const enzymes = ENZYME_DB.filter(e => {
  const site = e.recognition.toUpperCase()
  return motifCanReachSite(site, 'GATC', [1, 2]) || motifCanReachSite(site, 'CCWGG', [1, 3])
})
console.log(`${enzymes.length} enzymes have a site Dam or Dcm can reach`)

const result: Record<string, Partial<Record<Kind, Verdict>> & { from: 'summary' | 'records' }> = {}
for (const [i, e] of enzymes.entries()) {
  const summary = readSummary(await get(`http://rebase.neb.com/cgi-bin/damlist?e${encodeURIComponent(e.name)}`))
  await sleep(400)
  if (Object.keys(summary).length > 0) {
    result[e.name] = { ...summary, from: 'summary' }
  } else {
    const records = readRecords(await get(`http://rebase.neb.com/cgi-bin/msget?${encodeURIComponent(e.name)}`))
    await sleep(400)
    if (Object.keys(records).length > 0) result[e.name] = { ...records, from: 'records' }
  }
  if (i % 25 === 0) console.log(`  ${i}/${enzymes.length} ${e.name}`)
}

const sorted = Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)))
writeFileSync(outputPath, JSON.stringify({
  source: 'REBASE methylation sensitivity, rebase.neb.com/cgi-bin/damlist and cgi-bin/msget',
  fetched: new Date().toISOString().slice(0, 10),
  enzymes: sorted,
}, null, 1) + '\n')
console.log(`${Object.keys(sorted).length} enzymes with a Dam or Dcm verdict, written to ${outputPath}`)
