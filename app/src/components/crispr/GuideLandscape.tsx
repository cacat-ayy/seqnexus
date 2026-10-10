/**
 * Where the good guides are, as a strip above the list.
 *
 * A table of a thousand rows hides the one thing the eye is good at: whether
 * the candidates cluster, and where the gaps are. So the sequence is divided
 * into as many buckets as the strip is wide and each bucket draws its best
 * candidate, coloured by the worst flag that candidate carries. Clicking a
 * bucket selects that candidate.
 *
 * With a nuclease that has no activity model every bar is the same height:
 * the strip then shows where the sites are, which is still worth seeing, and
 * the caption says so rather than implying a score.
 */

import { useMemo } from 'react'
import type { GuideCandidate } from '../../crispr/types'
import { worstSeverity } from '../../crispr/score/rules'
import { guideKey } from '../../utils/guide-features'

const BUCKETS = 240
const HEIGHT = 46
const NO_MODEL_HEIGHT = 0.5

interface Props {
  candidates: readonly GuideCandidate[]
  seqLen: number
  selectedKey: string | null
  onPick: (key: string) => void
}

interface Bar {
  bucket: number
  height: number
  severity: 'none' | 'warn' | 'bad'
  key: string
}

export default function GuideLandscape({ candidates, seqLen, selectedKey, onPick }: Props) {
  const scored = candidates.some(c => c.scores.onTarget !== null)

  const bars = useMemo(() => {
    if (seqLen === 0 || candidates.length === 0) return []
    const best = new Map<number, { value: number; candidate: GuideCandidate }>()
    for (const candidate of candidates) {
      const bucket = Math.min(BUCKETS - 1, Math.floor((candidate.site.start / seqLen) * BUCKETS))
      const value = candidate.scores.onTarget ?? NO_MODEL_HEIGHT * 100
      const held = best.get(bucket)
      if (!held || value > held.value) best.set(bucket, { value, candidate })
    }
    const out: Bar[] = []
    for (const [bucket, { value, candidate }] of best) {
      out.push({
        bucket,
        height: Math.max(2, (value / 100) * (HEIGHT - 4)),
        severity: worstSeverity(candidate.scores.flags),
        key: guideKey(candidate.site),
      })
    }
    return out.sort((a, b) => a.bucket - b.bucket)
  }, [candidates, seqLen])

  if (bars.length === 0) return null

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width === 0) return
    const at = ((e.clientX - rect.left) / rect.width) * BUCKETS
    let nearest = bars[0]
    for (const bar of bars) {
      if (Math.abs(bar.bucket + 0.5 - at) < Math.abs(nearest.bucket + 0.5 - at)) nearest = bar
    }
    onPick(nearest.key)
  }

  return (
    <div
      className="gp-landscape"
      onClick={handleClick}
      title={scored
        ? 'The best candidate in each slice of the sequence, by score. Click to select one.'
        : 'Where the sites are. This nuclease has no activity model, so the bars are not scores.'}
    >
      <span className="gp-landscape-label">{scored ? 'Score by position' : 'Sites by position'}</span>
      <svg viewBox={`0 0 ${BUCKETS} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        {bars.map(bar => (
          <rect
            key={bar.bucket}
            className={`gp-bar${bar.key === selectedKey ? ' sel' : bar.severity === 'bad' ? ' bad' : bar.severity === 'warn' ? ' warn' : ''}`}
            x={bar.bucket}
            y={HEIGHT - 2 - bar.height}
            width={0.9}
            height={bar.height}
          />
        ))}
        <line className="gp-landscape-base" x1={0} y1={HEIGHT - 1.5} x2={BUCKETS} y2={HEIGHT - 1.5} />
      </svg>
    </div>
  )
}
