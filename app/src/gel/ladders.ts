/**
 * DNA size ladders for the virtual gel.
 *
 * Each band carries a mass so that brightness on the gel means something.
 * Most commercial ladders load roughly equal mass per band, with one or two
 * reference bands at ~2.5× so you can orient by eye. The masses below follow
 * that pattern for a 0.5 µg load; they are representative, not any one
 * vendor's datasheet. Lambda/HindIII is a digest of a single molecule, so its
 * fragments are equimolar and their masses scale with size, which is why its
 * 125 bp band is barely visible on a real gel too.
 */

export interface LadderBand {
  bp: number
  ng: number
  reference?: boolean
}

export interface Ladder {
  id: string
  name: string
  /** Descending by size. */
  bands: LadderBand[]
  /** Nominal total load in ng; the sum of `bands`. */
  totalNg: number
}

const NOMINAL_LOAD_NG = 500
const REFERENCE_FACTOR = 2.5

/** Equal mass per band, reference bands boosted, scaled to `total`. */
function equalMass(sizes: number[], references: number[] = [], total = NOMINAL_LOAD_NG): LadderBand[] {
  const weights = sizes.map(bp => (references.includes(bp) ? REFERENCE_FACTOR : 1))
  const sum = weights.reduce((a, b) => a + b, 0)
  return sizes.map((bp, i) => ({
    bp,
    ng: (total * weights[i]) / sum,
    ...(references.includes(bp) ? { reference: true } : {}),
  }))
}

/** Fragments of one molecule: equimolar, so mass is proportional to size. */
function equimolar(sizes: number[], total = NOMINAL_LOAD_NG): LadderBand[] {
  const sum = sizes.reduce((a, b) => a + b, 0)
  return sizes.map(bp => ({ bp, ng: (total * bp) / sum }))
}

function ladder(id: string, name: string, bands: LadderBand[]): Ladder {
  return { id, name, bands, totalNg: bands.reduce((a, b) => a + b.ng, 0) }
}

export const LADDERS: Ladder[] = [
  ladder('1kb', '1 kb DNA Ladder', equalMass(
    [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 750, 500, 250], [3000])),
  ladder('1kb-plus', '1 kb Plus DNA Ladder', equalMass(
    [15000, 10000, 8000, 7000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 850, 650, 500, 400, 300, 200, 100], [1500])),
  ladder('100bp', '100 bp DNA Ladder', equalMass(
    [1517, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100], [1000, 500])),
  ladder('50bp', '50 bp DNA Ladder', equalMass(
    [1350, 916, 766, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200, 150, 100, 50], [500])),
  ladder('lambda-hindiii', 'Lambda DNA/HindIII', equimolar(
    [23130, 9416, 6557, 4361, 2322, 2027, 564, 125])),
  ladder('1kb-extend', '1 kb Extend DNA Ladder', equalMass(
    [48502, 20000, 15000, 10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 750, 500, 250], [3000])),
  ladder('low-range', 'Low Range Ladder', equalMass(
    [766, 500, 350, 250, 200, 150, 100, 75, 50, 25])),
  ladder('hi-lo', 'Hi-Lo DNA Marker', equalMass(
    [10000, 8000, 6000, 4000, 3000, 2000, 1500, 1000, 750, 500, 250, 100])),
]

export const DEFAULT_LADDER_ID = LADDERS[0].id

/** Look a ladder up by id, or by display name (older saved gels stored names). */
export function getLadder(idOrName: string): Ladder | undefined {
  return LADDERS.find(l => l.id === idOrName) ?? LADDERS.find(l => l.name === idOrName)
}
