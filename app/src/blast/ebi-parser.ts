/**
 * Read EMBL-EBI's BLAST result (its XML result type, the EBI
 * ApplicationResult schema) into the drawer's BlastResult.
 *
 *   <EBIApplicationResult>
 *     <Header> … <sequence length="…"/> … </Header>
 *     <SequenceSimilaritySearchResult><hits>
 *       <hit number id ac length description database>
 *         <alignments><alignment>
 *           <score/> <bits/> <expectation/> <identity/> <positives/> <gaps/>
 *           <strand/> or <frame/>
 *           <querySeq start end/> <pattern/> <matchSeq start end/>
 *
 * Identity and positives are counted from the aligned sequences themselves,
 * so it does not matter whether the report gives them as counts or as
 * percentages. A minus strand or frame comes from <strand>/<frame> when
 * given, and from coordinates that run backwards otherwise.
 */

import { makeHit, sortHits, strandOf } from './parser'
import type { BlastHit, BlastHsp, BlastResult } from './types'

const text = (el: Element | null | undefined) => el?.textContent?.trim() ?? ''
const num = (s: string | null | undefined) => {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}
/** The first child element with this local name (the document has a default namespace). */
const child = (el: Element, name: string) => [...el.children].find(c => c.localName === name) ?? null
const all = (el: Element | Document, name: string) => [...el.getElementsByTagNameNS('*', name)]

/** "+1", "-2/+3", "plus/minus": the query's and the hit's parts. */
function split(s: string): [string, string] {
  const [a = '', b = ''] = s.split('/')
  return [a.trim(), b.trim()]
}

/** Identity and positives as fractions of the alignment, counted column by column. */
function counts(qseq: string, hseq: string, pattern: string): { identity: number; positives: number; gaps: number } {
  let same = 0, pos = 0, gaps = 0
  for (let i = 0; i < qseq.length; i++) {
    const q = qseq[i].toUpperCase(), h = (hseq[i] ?? '').toUpperCase()
    if (q === '-' || h === '-') { gaps++; continue }
    if (q === h) { same++; pos++ }
    else if (pattern[i] === '+') pos++
  }
  const n = qseq.length || 1
  return { identity: same / n, positives: pos / n, gaps }
}

/**
 * UniProt titles carry the organism as "OS=… OX=…"; ENA titles do not, and
 * the organism is then left empty rather than guessed from the description.
 */
function describe(raw: string): { description: string; sciName: string } {
  const os = /\sOS=(.+?)(?:\s(?:OX|GN|PE|SV)=|$)/.exec(raw)
  if (!os) return { description: raw, sciName: '' }
  return { description: raw.slice(0, os.index).trim(), sciName: os[1].trim() }
}

export function parseEbiXml(xml: string, program: string, database: string): BlastResult {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0 || !doc.documentElement) {
    throw new Error('not a readable XML result')
  }
  const root = doc.documentElement
  if (root.localName !== 'EBIApplicationResult') throw new Error(`unexpected result <${root.localName}>`)

  const queryLen = num(all(doc, 'sequence')[0]?.getAttribute('length'))
  const translatedQuery = program === 'blastx' || program === 'tblastx'
  const translatedHit = program === 'tblastn' || program === 'tblastx'

  const hits: BlastHit[] = all(doc, 'hit').map(hit => {
    const hsps: BlastHsp[] = all(hit, 'alignment').map(al => {
      const q = child(al, 'querySeq'), m = child(al, 'matchSeq')
      const qseq = text(q), hseq = text(m), pattern = child(al, 'pattern')?.textContent ?? ''
      const qs = num(q?.getAttribute('start')), qe = num(q?.getAttribute('end'))
      const hs = num(m?.getAttribute('start')), he = num(m?.getAttribute('end'))
      const [qStrandText, hStrandText] = split(text(child(al, 'strand')))
      const [qFrameText, hFrameText] = split(text(child(al, 'frame')))
      // One frame given for a program that translates one side belongs to that side.
      const qFrame = translatedQuery ? num(qFrameText) : 0
      const hFrame = translatedHit ? num(translatedQuery ? hFrameText : qFrameText || hFrameText) : 0
      const c = counts(qseq, hseq, pattern)
      return {
        bitScore: num(text(child(al, 'bits'))),
        evalue: num(text(child(al, 'expectation'))),
        identity: c.identity,
        positives: c.positives,
        gaps: c.gaps,
        alignLen: qseq.length,
        queryFrom: Math.min(qs, qe), queryTo: Math.max(qs, qe),
        hitFrom: Math.min(hs, he), hitTo: Math.max(hs, he),
        queryStrand: strandOf(qStrandText, qFrame, qs, qe),
        hitStrand: strandOf(hStrandText, hFrame, hs, he),
        queryFrame: qFrame,
        hitFrame: hFrame,
        qseq, hseq,
        midline: pattern.padEnd(qseq.length).slice(0, qseq.length),
      }
    })
    const { description, sciName } = describe(hit.getAttribute('description') ?? '')
    const accession = hit.getAttribute('ac') || hit.getAttribute('id') || ''
    return makeHit(accession, description, sciName, num(hit.getAttribute('length')), hsps, queryLen)
  }).filter(h => h.hsps.length > 0)
  sortHits(hits)

  return {
    program: program === 'megablast' ? 'blastn' : program,
    database,
    queryLen,
    hits,
    ...(hits.length === 0 ? { message: 'No hits found' } : {}),
  }
}
