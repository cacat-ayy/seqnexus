/** DNA size ladder definitions for virtual gel electrophoresis. */

export interface Ladder {
  name: string
  sizes: number[] // bp, descending
}

export const LADDERS: Ladder[] = [
  {
    name: '1 kb DNA Ladder',
    sizes: [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 750, 500, 250],
  },
  {
    name: '1 kb Plus DNA Ladder',
    sizes: [15000, 10000, 8000, 7000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 850, 650, 500, 400, 300, 200, 100],
  },
  {
    name: '100 bp DNA Ladder',
    sizes: [1517, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100],
  },
  {
    name: '50 bp DNA Ladder',
    sizes: [1350, 916, 766, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200, 150, 100, 50],
  },
  {
    name: 'Lambda DNA/HindIII',
    sizes: [23130, 9416, 6557, 4361, 2322, 2027, 564, 125],
  },
  {
    name: '1 kb Extend DNA Ladder',
    sizes: [48502, 20000, 15000, 10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 750, 500, 250],
  },
  {
    name: 'Low Range Ladder',
    sizes: [766, 500, 350, 250, 200, 150, 100, 75, 50, 25],
  },
  {
    name: 'Hi-Lo DNA Marker',
    sizes: [10000, 8000, 6000, 4000, 3000, 2000, 1500, 1000, 750, 500, 250, 100],
  },
]

export const DEFAULT_LADDER = LADDERS[0].name
