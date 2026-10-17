import { describe, it, expect } from 'vitest'
import {
  SCAFFOLDS, scaffoldsFor, defaultScaffold, scaffoldById, fullGuide, asRna, customScaffold,
} from './scaffolds'
import {
  annealedOligos, transcriptionTemplate, syntheticGuide, pegOrder, buildOrder, orderCsv,
  promoterPrefix, vectorPreset, VECTOR_PRESETS, T7_PROMOTER,
} from './order'
import {
  designPegRna, nickingGuides, pe3bGuides, describeEdit, editedSequence,
  DEFAULT_PEG, NICK_BAND,
} from './pegrna'
import { screeningPrimers, rflpOptions, rflpBands, deletionBands, DEFAULT_SCREEN } from './screen'
import { libraryMatches, recordFromCandidate, freeName, libraryCsv } from './library'
import { findGuideSites } from './finder'
import { scoreSites } from './score/guide'
import { builtInNuclease, NUCLEASES } from './nucleases'
import { reverseComplement } from '../models/complement'
import { getEnzyme } from '../enzymes/db'
import type { GuideCandidate, Nuclease } from './types'

const spCas9 = builtInNuclease('spcas9') as Nuclease
const nickase = builtInNuclease('spcas9-d10a') as Nuclease
const cas12a = builtInNuclease('ascas12a') as Nuclease
const sgRna = scaffoldById('spcas9-sgrna')!

const PAD = 'CATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCATCAT'
const SPACER = 'ACGTACGTACGTACGTACGT'

function scan(bases: string, nuclease: Nuclease = spCas9): GuideCandidate[] {
  const { sites } = findGuideSites(bases, nuclease, 'linear')
  return scoreSites(sites, nuclease, bases, 'linear')
}

describe('scaffolds', () => {
  it('ships only sequences it can stand behind, each saying what it is', () => {
    expect(SCAFFOLDS.length).toBeGreaterThanOrEqual(3)
    for (const s of SCAFFOLDS) {
      expect(s.sequence).toMatch(/^[ACGT]+$/)
      expect(s.note.length).toBeGreaterThan(10)
      expect(['after', 'before']).toContain(s.side)
    }
  })

  it('offers a nuclease its own scaffolds, and the ones you added on top', () => {
    const mine = customScaffold('Mine', 'acgu acgu', 'after', 'c1')
    expect(mine.sequence).toBe('ACGTACGT')
    const offered = scaffoldsFor(spCas9, [mine])
    expect(offered.map(s => s.id)).toContain('spcas9-sgrna')
    expect(offered.map(s => s.id)).toContain('c1')
    expect(scaffoldsFor(cas12a).map(s => s.id)).toEqual(['ascas12a-crrna'])
  })

  it('has no scaffold for a nuclease none ships for', () => {
    const sa = builtInNuclease('sacas9') as Nuclease
    expect(scaffoldsFor(sa)).toEqual([])
    expect(defaultScaffold(sa)).toBeUndefined()
  })

  it('puts the scaffold on the side the nuclease wants', () => {
    expect(fullGuide(SPACER, sgRna)).toBe(SPACER + sgRna.sequence)
    const repeat = scaffoldById('ascas12a-crrna')!
    expect(fullGuide(SPACER, repeat)).toBe(repeat.sequence + SPACER)
  })

  it('writes RNA as RNA', () => {
    expect(asRna('ACGT')).toBe('ACGU')
  })
})

describe('what to order', () => {
  const base = { name: 'g1', spacer: SPACER, nuclease: spCas9, scaffold: sgRna, promoter: 'u6' as const }

  it('adds the promoter base only when it is missing, and says so', () => {
    expect(promoterPrefix('GACGT', 'u6')).toBe('')
    expect(promoterPrefix('ACGT', 'u6')).toBe('G')
    expect(promoterPrefix('ACGT', 't7')).toBe('GG')
    expect(promoterPrefix('GACGT', 't7')).toBe('G')
    expect(promoterPrefix('GGACGT', 't7')).toBe('')
    expect(promoterPrefix('ACGT', 'none')).toBe('')
  })

  it('makes a pair of annealed oligos with the overhangs the vector wants', () => {
    const order = annealedOligos({ ...base, vector: vectorPreset('bbsi-cacc') })
    expect(order.oligos).toHaveLength(2)
    const [top, bottom] = order.oligos
    expect(top.sequence).toBe('CACC' + 'G' + SPACER)
    expect(bottom.sequence).toBe('AAAC' + reverseComplement('G' + SPACER))
    expect(order.notes.some(n => /A G was added/.test(n))).toBe(true)
  })

  it('leaves the G off a spacer that already starts with one', () => {
    const order = annealedOligos({ ...base, spacer: 'GCGTACGTACGTACGTACGT', vector: vectorPreset('bbsi-cacc') })
    expect(order.oligos[0].sequence).toBe('CACC' + 'GCGTACGTACGTACGTACGT')
    expect(order.notes.some(n => /was added/.test(n))).toBe(false)
  })

  it('builds a T7 template with its promoter and the whole guide', () => {
    const order = transcriptionTemplate(base)
    expect(order.oligos[0].sequence.startsWith(T7_PROMOTER)).toBe(true)
    expect(order.oligos[0].sequence).toContain(SPACER)
    expect(order.oligos[0].sequence).toContain(sgRna.sequence)
    expect(order.product?.sequence).toMatch(/^[ACGU]+$/)
  })

  it('orders a synthetic guide as RNA, with no promoter base added', () => {
    const order = syntheticGuide(base)
    expect(order.oligos[0].sequence).toBe(asRna(SPACER + sgRna.sequence))
    expect(order.oligos[0].sequence).not.toContain('T')
  })

  it('says when there is no scaffold to put on', () => {
    const order = syntheticGuide({ ...base, scaffold: undefined })
    expect(order.oligos[0].sequence).toBe(asRna(SPACER))
    expect(order.notes.some(n => /No scaffold/.test(n))).toBe(true)
  })

  it('orders a pegRNA with its tail', () => {
    const order = pegOrder({ ...base, extension: 'ACGTACGT' })
    expect(order.oligos[0].sequence.endsWith(asRna('ACGTACGT'))).toBe(true)
    expect(order.notes.some(n => /long for synthesis/.test(n))).toBe(true)
  })

  it('dispatches on the format and writes a table', () => {
    for (const format of ['annealed', 'template', 'synthetic', 'peg'] as const) {
      expect(buildOrder(format, { ...base, extension: 'ACGT' }).format).toBe(format)
    }
    const csv = orderCsv([annealedOligos(base)])
    expect(csv.split('\n')[0]).toBe('name,sequence,length,format')
    expect(csv.split('\n')).toHaveLength(3)
  })

  it('ships vector presets that name their enzyme', () => {
    for (const v of VECTOR_PRESETS) {
      expect(v.enzyme.length).toBeGreaterThan(2)
      expect(v.topOverhang).toMatch(/^[ACGT]+$/)
    }
  })
})

describe('pegRNA', () => {
  const bases = PAD + SPACER + 'AGG' + PAD
  const candidate = scan(bases, nickase).find(c => c.site.spacer === SPACER)!
  const settings = { ...DEFAULT_PEG, scaffold: sgRna.sequence }
  // The nick is three bases from the PAM, so inside the protospacer.
  const nick = PAD.length + 17

  it('builds the tail from the edited sequence and the bases before the nick', () => {
    const edit = { start: nick + 2, end: nick + 3, replacement: 'T' }
    const peg = designPegRna(candidate, bases, edit, settings)!
    expect(peg).not.toBeNull()
    expect(peg.nick).toBe(nick)
    expect(peg.pbs).toHaveLength(DEFAULT_PEG.pbsLength)
    expect(peg.pbs).toBe(reverseComplement(bases.slice(nick - DEFAULT_PEG.pbsLength, nick)))
    expect(peg.sequence).toBe(peg.spacer + peg.scaffold + peg.template + peg.pbs)
    expect(peg.extension).toBe(peg.template + peg.pbs)
  })

  it('writes the edit into the template', () => {
    const edit = { start: nick + 2, end: nick + 3, replacement: 'T' }
    const peg = designPegRna(candidate, bases, edit, settings)!
    // The template is the reverse complement of the edited strand, so the
    // edit shows as its complement when read back.
    const written = reverseComplement(peg.template)
    expect(written[2]).toBe('T')
    expect(written.length).toBe(3 + DEFAULT_PEG.homologyAfterEdit)
  })

  it('handles an insertion and a deletion', () => {
    const insertion = designPegRna(candidate, bases, { start: nick + 2, end: nick + 2, replacement: 'GGGG' }, settings)!
    expect(reverseComplement(insertion.template)).toContain('GGGG')
    const deletion = designPegRna(candidate, bases, { start: nick + 2, end: nick + 6, replacement: '' }, settings)!
    expect(deletion.template.length).toBe(2 + DEFAULT_PEG.homologyAfterEdit)
  })

  it('refuses an edit the template cannot reach', () => {
    expect(designPegRna(candidate, bases, { start: nick - 10, end: nick - 9, replacement: 'T' }, settings)).toBeNull()
  })

  it('warns about a primer site outside the usual band and a GC-rich one', () => {
    const short = designPegRna(candidate, bases, { start: nick + 1, end: nick + 2, replacement: 'T' }, { ...settings, pbsLength: 4 })!
    expect(short.warnings.some(w => /outside the usual/.test(w))).toBe(true)
  })

  it('warns when there is almost no template past the edit', () => {
    const peg = designPegRna(candidate, bases, { start: nick + 1, end: nick + 2, replacement: 'T' }, { ...settings, homologyAfterEdit: 2 })!
    expect(peg.warnings.some(w => /almost nothing to pair with/.test(w))).toBe(true)
  })

  it('works on a guide reading the other strand', () => {
    const rc = reverseComplement(bases)
    const reverse = scan(rc, nickase).find(c => c.site.spacer === SPACER)!
    expect(reverse.site.strand).toBe(-1)
    const rNick = reverse.site.cutBottom
    const peg = designPegRna(reverse, rc, { start: rNick - 3, end: rNick - 2, replacement: 'A' }, settings)
    expect(peg).not.toBeNull()
    expect(peg!.pbs).toHaveLength(DEFAULT_PEG.pbsLength)
  })

  it('offers second nicks on the other strand, inside the band', () => {
    const long = PAD + SPACER + 'AGG' + 'GGCCTTAAGGCCTTAAGGCC' + 'CCATGGCCATGGCCATGGCC' + PAD + PAD
    const cands = scan(long, nickase)
    const peg = designPegRna(
      cands.find(c => c.site.spacer === SPACER)!,
      long,
      { start: PAD.length + 19, end: PAD.length + 20, replacement: 'T' },
      settings,
    )!
    const nicks = nickingGuides(cands, peg, { low: 10, high: 120 })
    expect(nicks.every(n => n.opposite)).toBe(true)
    for (const n of nicks) {
      expect(n.distance).toBeGreaterThanOrEqual(10)
      expect(n.distance).toBeLessThanOrEqual(120)
    }
  })

  it('names the edit the way a notebook would', () => {
    expect(describeEdit({ start: 11, end: 12, replacement: 'G' }, 'ACGTACGTACGTACGT')).toBe('12T>G')
    expect(describeEdit({ start: 11, end: 11, replacement: 'TTT' }, 'ACGTACGTACGTACGT')).toBe('12_13insTTT')
    expect(describeEdit({ start: 11, end: 14, replacement: '' }, 'ACGTACGTACGTACGT')).toBe('12_14del')
    expect(editedSequence('AAAA', { start: 1, end: 3, replacement: 'G' })).toBe('AGA')
  })
})

describe('screening', () => {
  // A long enough stretch for a real amplicon, with a known enzyme site at the cut.
  let x = 99
  const rnd = () => { x = (x * 1103515245 + 12345) >>> 0; return 'ACGT'[(x >>> 16) % 4] }
  let filler = ''
  while (filler.length < 1200) filler += rnd()
  const cut = 600
  // Put an EcoRI site across the cut: GAATTC with the cut inside it.
  const bases = filler.slice(0, cut - 3) + 'GAATTC' + filler.slice(cut + 3)

  it('designs primers that put the cut well inside the amplicon', () => {
    const pairs = screeningPrimers(bases, 'linear', cut)
    expect(pairs.length).toBeGreaterThan(0)
    for (const p of pairs) {
      expect(p.productSize).toBeGreaterThanOrEqual(DEFAULT_SCREEN.minProduct)
      expect(p.productSize).toBeLessThanOrEqual(DEFAULT_SCREEN.maxProduct)
      expect(p.cutOffset).toBeGreaterThan(0)
      expect(p.cutOffset).toBeLessThan(p.productSize)
      expect(p.forward.sequence).toMatch(/^[ACGT]+$/)
    }
  })

  it('finds an enzyme whose site the cut sits inside', () => {
    const options = rflpOptions(bases, cut, { start: cut - 300, end: cut + 300 })
    const ecoRI = options.find(o => o.enzyme.name === 'EcoRI')
    expect(ecoRI).toBeDefined()
    expect(ecoRI?.sitesInAmplicon).toBe(1)
    expect(ecoRI!.site.position).toBeLessThanOrEqual(cut)
    expect(ecoRI!.site.end).toBeGreaterThanOrEqual(cut)
  })

  it('leaves out an enzyme that cuts the amplicon more than once', () => {
    const twice = 'GAATTC' + filler.slice(0, 200) + 'GAATTC' + filler.slice(200, 400)
    const options = rflpOptions(twice, 3, { start: 0, end: twice.length })
    expect(options.find(o => o.enzyme.name === 'EcoRI')).toBeUndefined()
  })

  it('leaves out an enzyme whose site the cut misses', () => {
    const options = rflpOptions(bases, cut + 200, { start: cut - 300, end: cut + 300 })
    expect(options.find(o => o.enzyme.name === 'EcoRI')).toBeUndefined()
  })

  it('says what the gel should show', () => {
    expect(rflpBands(600, 250)).toEqual([
      { label: 'Unedited, digested', sizes: [350, 250] },
      { label: 'Edited, digested', sizes: [600] },
    ])
    expect(deletionBands(800, 300)).toEqual([
      { label: 'Unedited', sizes: [800] },
      { label: 'Deleted', sizes: [500] },
    ])
  })

  it('knows the enzyme it names', () => {
    expect(getEnzyme('EcoRI')?.recognition).toBe('GAATTC')
  })
})

describe('the guide library', () => {
  const bases = PAD + SPACER + 'AGG' + PAD
  const candidate = scan(bases).find(c => c.site.spacer === SPACER)!

  it('keeps a guide with where and when it came from', () => {
    const record = recordFromCandidate(candidate, spCas9, 'g1', 'tab1', 'pDemo', 'id1')
    expect(record.spacer).toBe(SPACER)
    expect(record.nucleaseId).toBe('spcas9')
    expect(record.origin).toMatchObject({ documentName: 'pDemo', start: PAD.length, strand: 1 })
    expect(record.scores).toBe(candidate.scores)
    expect(record.createdAt).toBeGreaterThan(0)
  })

  it('finds where a kept guide binds in a sequence, and says when it does not', () => {
    const record = recordFromCandidate(candidate, spCas9, 'g1', null, null, 'id1')
    const here = libraryMatches([record], bases, 'linear')
    expect(here[0].site?.start).toBe(PAD.length)
    expect(here[0].siteCount).toBe(1)

    const elsewhere = libraryMatches([record], PAD + PAD, 'linear')
    expect(elsewhere[0].site).toBeNull()
    expect(elsewhere[0].siteCount).toBe(0)
  })

  it('counts a guide that binds more than once', () => {
    const twice = PAD + SPACER + 'AGG' + PAD + SPACER + 'AGG' + PAD
    const record = recordFromCandidate(candidate, spCas9, 'g1', null, null, 'id1')
    expect(libraryMatches([record], twice, 'linear')[0].siteCount).toBe(2)
  })

  it('keeps names apart', () => {
    const kept = [{ name: 'guide' }, { name: 'guide 2' }] as never as Parameters<typeof freeName>[1]
    expect(freeName('guide', kept)).toBe('guide 3')
    expect(freeName('other', kept)).toBe('other')
  })

  it('writes the library out as a table', () => {
    const record = recordFromCandidate(candidate, spCas9, 'g1', 'tab1', 'pDemo', 'id1')
    const csv = libraryCsv([{ ...record, notes: 'a note\nwith a line break' }])
    expect(csv.split('\n')[0]).toBe('name,spacer,pam,nuclease,from,at,notes')
    expect(csv.split('\n')).toHaveLength(2)
    expect(csv.split('\n')[1]).toContain('pDemo')
    expect(csv.split('\n')[1]).not.toContain('\r')
  })
})

describe('screening across an origin', () => {
  let x = 4242
  const rnd = () => { x = (x * 1103515245 + 12345) >>> 0; return 'ACGT'[(x >>> 16) % 4] }
  let plasmid = ''
  while (plasmid.length < 1400) plasmid += rnd()
  // A cut near position 5, so an amplicon around it must cross the origin.
  const circular = plasmid.slice(0, 2) + 'GAATTC' + plasmid.slice(8)
  const cut = 5

  it('measures how far into the product the cut falls, even when it wraps', () => {
    const pairs = screeningPrimers(circular, 'circular', cut)
    expect(pairs.length).toBeGreaterThan(0)
    for (const p of pairs) {
      expect(p.cutOffset).toBeGreaterThanOrEqual(0)
      expect(p.cutOffset).toBeLessThanOrEqual(p.productSize)
    }
  })

  it('finds an enzyme in an amplicon that crosses the origin', () => {
    const amplicon = { start: circular.length - 300, end: circular.length - 300 + 600 }
    const options = rflpOptions(circular, cut, amplicon)
    const ecoRI = options.find(o => o.enzyme.name === 'EcoRI')
    expect(ecoRI).toBeDefined()
    expect(ecoRI!.site.position).toBe(2)
  })

  it('ignores a cut that falls outside a wrapped amplicon', () => {
    const amplicon = { start: 700, end: 1000 }
    expect(rflpOptions(circular, cut, amplicon).find(o => o.enzyme.name === 'EcoRI')).toBeUndefined()
  })
})

describe('what actually gets ordered', () => {
  // These are the cases where a wrong base is a wasted order rather than a
  // wrong number on a screen.
  const cas12aRepeat = scaffoldById('ascas12a-crrna')!
  const CAS12A_SPACER = 'ACGTACGTACGTACGTACGTACG'

  it('transcribes exactly the guide it shows, with no extra G', () => {
    // The promoter constant ends before the transcript starts, so the bases
    // the template adds and the bases the product shows are the same bases.
    const order = transcriptionTemplate({
      name: 'g', spacer: SPACER, nuclease: spCas9, scaffold: sgRna, promoter: 't7',
    })
    const template = order.oligos[0].sequence
    expect(template.startsWith(T7_PROMOTER)).toBe(true)
    const transcribed = template.slice(T7_PROMOTER.length)
    expect(asRna(transcribed)).toBe(order.product!.sequence)
    expect(transcribed.startsWith('GG' + SPACER)).toBe(true)
    expect(transcribed.startsWith('GGG')).toBe(false)
  })

  it('adds only the missing G when the spacer already starts on one', () => {
    const order = transcriptionTemplate({
      name: 'g', spacer: 'G' + SPACER.slice(1), nuclease: spCas9, scaffold: sgRna, promoter: 't7',
    })
    const transcribed = order.oligos[0].sequence.slice(T7_PROMOTER.length)
    expect(asRna(transcribed)).toBe(order.product!.sequence)
    expect(transcribed.slice(1)).toBe('G' + SPACER.slice(1) + sgRna.sequence)
    expect(transcribed.startsWith('GG')).toBe(true)
  })

  it('leaves a Cas12a crRNA alone: the repeat is what transcription starts on', () => {
    const template = transcriptionTemplate({
      name: 'c', spacer: CAS12A_SPACER, nuclease: cas12a, scaffold: cas12aRepeat, promoter: 't7',
    })
    const transcribed = template.oligos[0].sequence.slice(T7_PROMOTER.length)
    // The spacer follows the repeat immediately: nothing is inserted between.
    expect(transcribed.endsWith(cas12aRepeat.sequence + CAS12A_SPACER)).toBe(true)
    expect(asRna(transcribed)).toBe(template.product!.sequence)

    const annealed = annealedOligos({
      name: 'c', spacer: CAS12A_SPACER, nuclease: cas12a, scaffold: cas12aRepeat,
      promoter: 'u6', vector: vectorPreset('cas12a-agat'),
    })
    expect(annealed.oligos[0].sequence).toBe('AGAT' + CAS12A_SPACER)
    expect(annealed.oligos[1].sequence).toBe('TGTA' + reverseComplement(CAS12A_SPACER))
  })

  it('gives each Cas12a orthologue its own repeat', () => {
    // AsCas12a and LbCas12a do not share a direct repeat.
    const as = defaultScaffold(builtInNuclease('ascas12a')!)!
    const lb = defaultScaffold(builtInNuclease('lbcas12a')!)!
    const en = defaultScaffold(builtInNuclease('encas12a')!)!
    expect(as.sequence).toBe('TAATTTCTACTCTTGTAGAT')
    expect(lb.sequence).toBe('AATTTCTACTAAGTGTAGAT')
    expect(en.sequence).toBe(as.sequence)
    expect(lb.sequence).not.toBe(as.sequence)
  })

  it('still builds the standard BbsI duplex for an sgRNA', () => {
    // CACCG over AAAC with the matching C: the pair the usual vectors want.
    const order = annealedOligos({
      name: 'g', spacer: SPACER, nuclease: spCas9, promoter: 'u6', vector: vectorPreset('bbsi-cacc'),
    })
    expect(order.oligos[0].sequence).toBe('CACCG' + SPACER)
    expect(order.oligos[1].sequence).toBe('AAAC' + reverseComplement(SPACER) + 'C')
  })
})

describe('a second nick for prime editing', () => {
  it('measures the distance the short way round a circle', () => {
    const body = pseudoRandom(500)
    const spacer = body.slice(5, 25)
    const bases = body.slice(0, 5) + spacer + 'AGG' + body.slice(28)
    const scan = findGuideSites(bases, spCas9, 'circular')
    const cands = scoreSites(scan.sites, spCas9, bases, 'circular')
    const candidate = cands.find(c => c.site.spacer === spacer && c.site.strand === 1)!
    const peg = designPegRna(candidate, bases, { start: 40, end: 41, replacement: 'A' },
      { ...DEFAULT_PEG, scaffold: sgRna.sequence })!
    // The pegRNA nicks just after the origin, so every second nick in the
    // band sits before it.
    expect(peg.nick).toBeLessThan(40)
    const linear = nickingGuides(cands, peg)
    const circular = nickingGuides(cands, peg, undefined, { length: bases.length, topology: 'circular' })
    expect(circular.length).toBeGreaterThan(linear.length)
    for (const nick of circular) {
      const at = nick.candidate.site.strand === 1 ? nick.candidate.site.cutTop : nick.candidate.site.cutBottom
      const plain = Math.abs(at - peg.nick)
      expect(Math.min(plain, bases.length - plain)).toBe(nick.distance)
    }
  })
})

describe('a nickase is not a break', () => {
  it('reports no out-of-frame share for a nick', () => {
    const bases = PAD.repeat(3) + SPACER + 'AGG' + PAD.repeat(3)
    const cutter = scoreSites(findGuideSites(bases, spCas9, 'linear').sites, spCas9, bases)
    const nicker = scoreSites(findGuideSites(bases, nickase, 'linear').sites, nickase, bases)
    const cut = cutter.find(c => c.site.spacer === SPACER)!
    const nick = nicker.find(c => c.site.spacer === SPACER)!
    expect(cut.scores.outOfFrame).not.toBeNull()
    expect(nick.scores.outOfFrame).toBeNull()
  })
})

/** A repeatable sequence with PAMs scattered through it. */
function pseudoRandom(n: number, seed = 7): string {
  let s = seed
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    out.push('ACGT'[(s >>> 16) & 3])
  }
  return out.join('')
}

describe('PE3b: a second nick that waits for the edit', () => {
  const SC = sgRna.sequence

  /** A sequence with a pegRNA site at 80 and no NGG near the edit. */
  function build() {
    const body = pseudoRandom(400, 11).split('')
    // The pegRNA guide: spacer at 80..100 with an AGG PAM, so its nick is 97.
    const spacer = 'ACGTTGCATGCAACGTTGCA'
    for (let i = 0; i < 20; i++) body[80 + i] = spacer[i]
    for (const [i, b] of [...'AGG'].entries()) body[100 + i] = b
    // Clear the region the second nick would come from, so only the planted
    // one is there: no CC on the sense strand means no antisense PAM.
    for (let i = 130; i < 200; i++) body[i] = i % 2 === 0 ? 'A' : 'T'
    return { bases: body.join(''), spacer }
  }

  it('offers a guide whose PAM the edit creates, and marks it', () => {
    const { bases, spacer } = build()
    const scan = findGuideSites(bases, spCas9, 'linear')
    const cands = scoreSites(scan.sites, spCas9, bases, 'linear')
    const candidate = cands.find(c => c.site.spacer === spacer && c.site.strand === 1)!
    // Replace two bases at 151 with CC, which makes an antisense PAM there
    // and so a guide nicking at 157, sixty bases from the pegRNA's own nick.
    const edit = { start: 151, end: 153, replacement: 'CC' }
    const peg = designPegRna(candidate, bases, edit, { ...DEFAULT_PEG, scaffold: SC })!
    expect(peg.nick).toBe(97)

    const plain = nickingGuides(cands, peg)
    expect(plain.some(n => n.pe3b)).toBe(false)

    const edited = editedSequence(bases, edit)
    const editedScan = findGuideSites(edited, spCas9, 'linear')
    const pe3b = pe3bGuides(scoreSites(editedScan.sites, spCas9, edited, 'linear'), peg, edit)
    expect(pe3b.length).toBeGreaterThan(0)
    for (const n of pe3b) {
      expect(n.pe3b).toBe(true)
      expect(n.opposite).toBe(true)
      expect(n.distance).toBeGreaterThanOrEqual(NICK_BAND.low)
      expect(n.distance).toBeLessThanOrEqual(NICK_BAND.high)
      // The site has to touch the edit, or it would bind without it.
      const { start, end, pamStart, pamEnd } = n.candidate.site
      const touches = (a: number, b: number) => a < 153 && b > 151
      expect(touches(start, end) || touches(pamStart, pamEnd)).toBe(true)
      // And the sequence as it stands offers no such guide: the spacer may
      // be there, but without the PAM the edit brings, nothing binds it.
      expect(cands.some(c => c.site.spacer === n.candidate.site.spacer
        && c.site.strand === n.candidate.site.strand)).toBe(false)
    }
  })

  it('sorts a PE3b guide ahead of an ordinary second nick', () => {
    const { bases, spacer } = build()
    const scan = findGuideSites(bases, spCas9, 'linear')
    const cands = scoreSites(scan.sites, spCas9, bases, 'linear')
    const candidate = cands.find(c => c.site.spacer === spacer && c.site.strand === 1)!
    const edit = { start: 151, end: 153, replacement: 'CC' }
    const peg = designPegRna(candidate, bases, edit, { ...DEFAULT_PEG, scaffold: SC })!
    const edited = editedSequence(bases, edit)
    const editedScan = findGuideSites(edited, spCas9, 'linear')
    const all = [
      ...pe3bGuides(scoreSites(editedScan.sites, spCas9, edited, 'linear'), peg, edit),
      ...nickingGuides(cands, peg),
    ]
    const sorted = nickingGuides(all.map(n => n.candidate), peg)
    expect(sorted.length).toBeGreaterThan(0)
    expect(all[0].pe3b).toBe(true)
  })
})

describe('every shipped nuclease can be ordered', () => {
  it('offers a scaffold for each nuclease that has one on file', () => {
    // A nuclease whose row names a scaffold has to see it in the picker too,
    // or the panel says none ships while the builder quietly uses one.
    for (const n of NUCLEASES) {
      // A row may name a family whose sequence does not ship, and then the
      // panel asks for it. What must not happen is a scaffold that ships and
      // is used, while the picker says none does.
      if (!n.scaffoldId || !scaffoldById(n.scaffoldId)) continue
      expect(scaffoldsFor(n).map(s => s.id), n.id).toContain(n.scaffoldId)
      expect(defaultScaffold(n)?.id, n.id).toBe(n.scaffoldId)
    }
  })
})
