/**
 * Compact inline chromatogram strip for contig view.
 *
 * Renders the 4 fluorescence trace channels (A/C/G/T) aligned to the
 * base cell grid. Uses a piecewise linear mapping from pixel position
 * to trace sample position, anchored at each base's peak. This handles
 * both forward and RC reads seamlessly.
 */

import { useRef, useEffect } from 'react'
import type { Ab1Data } from '../io/ab1'
import type { ReadMapping } from '../alignment/contig'

const TRACE_COLORS: Record<string, string> = {
  A: '#22c55e',
  C: '#3b82f6',
  G: '#666',
  T: '#ef4444',
}

const TRACE_HEIGHT = 36

interface Props {
  data: Ab1Data
  mapping: ReadMapping
  trimStart: number
  trimEnd: number
  blockStart: number
  blockLen: number
  cellW: number
  isRC: boolean
}

export default function InlineChromatogram({
  data, mapping, trimStart, trimEnd, blockStart, blockLen, cellW, isRC,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const width = blockLen * cellW
    const height = TRACE_HEIGHT
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const { peakLocations, traces } = data
    const totalBases = peakLocations.length
    const effectiveTrimEnd = trimEnd > 0 ? trimEnd : data.bases.length
    const trimmedLen = effectiveTrimEnd - trimStart

    // Map each visible cell to its peak sample position
    type CellInfo = { col: number; peakSample: number }
    const cells: CellInfo[] = []

    for (let i = 0; i < blockLen; i++) {
      const refPos = blockStart + i
      if (refPos < mapping.startPos || refPos > mapping.endPos) continue
      if (!mapping.bases.has(refPos)) continue

      let baseIdx = 0
      for (let p = mapping.startPos; p < refPos; p++) {
        if (mapping.bases.has(p)) baseIdx++
      }

      const origIdx = isRC
        ? trimStart + (trimmedLen - 1 - baseIdx)
        : trimStart + baseIdx

      if (origIdx < 0 || origIdx >= totalBases) continue
      cells.push({ col: i, peakSample: peakLocations[origIdx] })
    }

    if (cells.length === 0) return

    // Compute max intensity from the visible sample range (same as ChromatogramView)
    let minSample = Infinity, maxSample = 0
    for (const c of cells) {
      if (c.peakSample < minSample) minSample = c.peakSample
      if (c.peakSample > maxSample) maxSample = c.peakSample
    }
    const pad = Math.floor((maxSample - minSample) / cells.length) || 10
    const scanStart = Math.max(0, minSample - pad)
    const scanEnd = Math.min(traces.A.length - 1, maxSample + pad)
    let maxIntensity = 100
    for (let s = scanStart; s <= scanEnd; s++) {
      for (const ch of ['A', 'C', 'G', 'T'] as const) {
        if (traces[ch][s] > maxIntensity) maxIntensity = traces[ch][s]
      }
    }
    maxIntensity *= 1.1

    // Build piecewise linear mapping: pixel-x → trace sample position.
    // Each cell's center maps to its peakSample. Interpolate between anchors.
    const anchors: { x: number; sample: number }[] = []
    for (const cell of cells) {
      anchors.push({ x: (cell.col + 0.5) * cellW, sample: cell.peakSample })
    }

    // Extend to cover edges of first/last cells
    if (anchors.length >= 2) {
      const first = anchors[0], second = anchors[1]
      const rate = (second.sample - first.sample) / (second.x - first.x)
      const startX = cells[0].col * cellW
      anchors.unshift({ x: startX, sample: first.sample - (first.x - startX) * rate })

      const last = anchors[anchors.length - 1], prev = anchors[anchors.length - 2]
      const rateEnd = (last.sample - prev.sample) / (last.x - prev.x)
      const endX = (cells[cells.length - 1].col + 1) * cellW
      anchors.push({ x: endX, sample: last.sample + (endX - last.x) * rateEnd })
    }

    const xToSample = (x: number): number => {
      if (anchors.length <= 1) return anchors[0]?.sample ?? 0
      if (x <= anchors[0].x) return anchors[0].sample
      if (x >= anchors[anchors.length - 1].x) return anchors[anchors.length - 1].sample
      for (let i = 0; i < anchors.length - 1; i++) {
        if (x >= anchors[i].x && x <= anchors[i + 1].x) {
          const t = (x - anchors[i].x) / (anchors[i + 1].x - anchors[i].x)
          return anchors[i].sample + t * (anchors[i + 1].sample - anchors[i].sample)
        }
      }
      return anchors[anchors.length - 1].sample
    }

    const pxStart = cells[0].col * cellW
    const pxEnd = (cells[cells.length - 1].col + 1) * cellW

    for (const ch of ['A', 'C', 'G', 'T'] as const) {
      const trace = traces[ch]
      ctx.strokeStyle = TRACE_COLORS[ch]
      ctx.lineWidth = 0.8
      ctx.globalAlpha = 0.75
      ctx.beginPath()
      let first = true

      for (let px = pxStart; px <= pxEnd; px += 0.5) {
        const s = xToSample(px)
        const si = Math.floor(s)
        const sf = s - si
        const v0 = si >= 0 && si < trace.length ? trace[si] : 0
        const v1 = si + 1 < trace.length ? trace[si + 1] : v0
        const v = v0 + sf * (v1 - v0)
        const y = height - (v / maxIntensity) * (height - 2) - 1
        if (first) { ctx.moveTo(px, y); first = false }
        else ctx.lineTo(px, y)
      }
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }, [data, mapping, trimStart, trimEnd, blockStart, blockLen, cellW, isRC])

  return (
    <canvas
      ref={canvasRef}
      className="inline-chromatogram"
      style={{ width: blockLen * cellW, height: TRACE_HEIGHT, display: 'block' }}
    />
  )
}
