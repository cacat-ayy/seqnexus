import { describe, it, expect } from 'vitest'
import { migrationMm, sizeAtMm, resolutionRange, dyeFronts, gelCaption, runLengthMm } from './migration'
import { simulateLane } from './simulate'
import { layoutGel } from './bands'
import { formatGelSize, DEFAULT_CONDITIONS, type GelConditions } from './model'
import { laddersFor, getLadder, DEFAULT_PROTEIN_LADDER_ID } from './ladders'
import { sanitizeWorkspace, defaultWorkspace, autoLaneLabel, DEFAULT_PAGE_CONDITIONS } from './workspace'
import { describeSpecies } from './report'

const PAGE: GelConditions = { ...DEFAULT_CONDITIONS, kind: 'sds-page', acrylamidePct: 12, dyeFront: 0.9 }

const gfp = 'MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLTYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITHGMDELYK'
const resolve = (id: string) => (id === 'p' ? { name: 'GFP', bases: gfp, topology: 'linear' as const, alphabet: 'protein' as const }
  : id === 'd' ? { name: 'DNA', bases: 'ATGC'.repeat(100), topology: 'linear' as const } : null)

describe('SDS-PAGE migration', () => {
  it('smaller proteins run further, inside the run', () => {
    const big = migrationMm(100_000, 'linear', PAGE)
    const mid = migrationMm(30_000, 'linear', PAGE)
    const small = migrationMm(10_000, 'linear', PAGE)
    expect(big).toBeLessThan(mid)
    expect(mid).toBeLessThan(small)
    expect(small).toBeLessThanOrEqual(runLengthMm(PAGE))
  })

  it('a 12% gel resolves roughly 15 to 80 kDa and inverts its own curve', () => {
    const [lo, hi] = resolutionRange(PAGE)
    expect(lo).toBeGreaterThan(5_000)
    expect(lo).toBeLessThan(25_000)
    expect(hi).toBeGreaterThan(50_000)
    expect(hi).toBeLessThan(200_000)
    const mm = migrationMm(30_000, 'linear', PAGE)
    expect(sizeAtMm(mm, PAGE)!).toBeCloseTo(30_000, -2)
  })

  it('denser gels hold small proteins back', () => {
    const at15 = migrationMm(20_000, 'linear', { ...PAGE, acrylamidePct: 15 })
    const at8 = migrationMm(20_000, 'linear', { ...PAGE, acrylamidePct: 8 })
    expect(at15).toBeLessThan(at8)
  })

  it('carries one dye at the front and says what it is', () => {
    const fronts = dyeFronts(PAGE)
    expect(fronts).toHaveLength(1)
    expect(fronts[0].mm).toBeCloseTo(0.9 * runLengthMm(PAGE), 5)
    expect(gelCaption(PAGE)).toBe('12% SDS-PAGE · Mini (7 cm)')
    expect(gelCaption(DEFAULT_CONDITIONS)).toContain('agarose')
  })

  it('prints sizes in the gel unit', () => {
    expect(formatGelSize(27_000, PAGE)).toBe('27.0 kDa')
    expect(formatGelSize(250_000, PAGE)).toBe('250 kDa')
    expect(formatGelSize(850, PAGE)).toBe('850 Da')
    expect(formatGelSize(1500, DEFAULT_CONDITIONS)).toBe('1.5 kb')
    expect(describeSpecies({ bp: 27_000, form: 'linear', ng: 100, mm: 0, sigmaMm: 0 }, PAGE)).toBe('27.0 kDa')
  })
})

describe('protein lanes', () => {
  it('runs an intact protein as one band of its average mass', () => {
    const sim = simulateLane({ kind: 'protein', sourceId: 'p', ng: 2000, proteases: [] }, resolve)
    expect(sim.species).toHaveLength(1)
    expect(sim.species[0].bp).toBeGreaterThan(26_000)
    expect(sim.species[0].bp).toBeLessThan(28_000)
    expect(sim.species[0].ng).toBe(2000)
  })

  it('digests with a protease into peptides that share the load', () => {
    const sim = simulateLane({ kind: 'protein', sourceId: 'p', ng: 2000, proteases: ['trypsin'] }, resolve)
    expect(sim.species.length).toBeGreaterThan(10)
    const total = sim.species.reduce((a, s) => a + s.ng, 0)
    expect(total).toBeCloseTo(2000, 0)
    expect(sim.species.every(s => s.fragment)).toBe(true)
  })

  it('refuses DNA and a missing source', () => {
    expect(simulateLane({ kind: 'protein', sourceId: 'd', ng: 2000, proteases: [] }, resolve).warnings[0]).toMatch(/DNA/)
    expect(simulateLane({ kind: 'protein', sourceId: 'x', ng: 2000, proteases: [] }, resolve).warnings[0]).toMatch(/no longer/)
  })

  it('lays out a protein gel with a protein ladder', () => {
    const ladder = getLadder(DEFAULT_PROTEIN_LADDER_ID)!
    expect(ladder.kind).toBe('protein')
    expect(laddersFor('protein').length).toBeGreaterThanOrEqual(3)
    expect(laddersFor('dna').every(l => (l.kind ?? 'dna') === 'dna')).toBe(true)
    const layout = layoutGel({
      conditions: PAGE,
      lanes: [
        { id: 'l', sample: { kind: 'ladder', ladderId: DEFAULT_PROTEIN_LADDER_ID } },
        { id: 'g', sample: { kind: 'protein', sourceId: 'p', ng: 2000, proteases: [] } },
      ],
    }, resolve)
    expect(layout.lanes[0].bands.length).toBeGreaterThan(5)
    expect(layout.lanes[1].bands).toHaveLength(1)
    // GFP at 27 kDa lands between the 25 and 35 kDa ladder bands.
    const band = layout.lanes[1].bands[0]
    const l25 = layout.lanes[0].bands.find(b => b.members[0].bp === 25_000)!
    const l35 = layout.lanes[0].bands.find(b => b.members[0].bp === 35_000)!
    expect(band.mm).toBeGreaterThan(l35.mm)
    expect(band.mm).toBeLessThan(l25.mm)
  })
})

describe('protein gel workspace', () => {
  it('starts a protein on SDS-PAGE with a ladder, the protein and a tryptic digest', () => {
    const ws = defaultWorkspace({ id: 'p', bases: gfp, topology: 'linear', alphabet: 'protein', shownEnzymes: [] })
    expect(ws.conditions.kind).toBe('sds-page')
    expect(ws.lanes.map(l => l.sample.kind)).toEqual(['ladder', 'protein', 'protein'])
    expect(autoLaneLabel(ws.lanes[2].sample, () => 'GFP')).toBe('GFP trypsin')
  })

  it('survives a round trip through sanitizing', () => {
    const ws = sanitizeWorkspace(JSON.parse(JSON.stringify({
      conditions: DEFAULT_PAGE_CONDITIONS,
      display: {},
      lanes: [
        { id: 'a', sample: { kind: 'protein', sourceId: 'p', ng: 2000, proteases: ['trypsin'], missedCleavages: 1 } },
        { id: 'b', sample: { kind: 'ladder', ladderId: DEFAULT_PROTEIN_LADDER_ID } },
      ],
    })))!
    expect(ws.conditions.kind).toBe('sds-page')
    expect(ws.conditions.acrylamidePct).toBe(12)
    expect(ws.lanes[0].sample).toMatchObject({ kind: 'protein', proteases: ['trypsin'], missedCleavages: 1 })
    expect(ws.lanes[1].sample).toMatchObject({ kind: 'ladder', ladderId: DEFAULT_PROTEIN_LADDER_ID })
  })
})
