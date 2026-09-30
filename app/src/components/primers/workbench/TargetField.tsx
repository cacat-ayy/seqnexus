/** The target row of a workbench task: follow the selection, or type positions. */

import { fmtRegion, regionLength, type SelectionTarget } from './target'

export function TargetField({ label, hint, t, n }: {
  label: string
  /** Shown when there is no target yet. */
  hint: string
  t: SelectionTarget
  n: number
}) {
  const { target, follow } = t
  return (
    <>
      <div className="wb-row">
        <label>{label}</label>
        <label className="wb-check">
          <input type="checkbox" checked={follow} onChange={e => t.setFollow(e.target.checked)} />
          Follow selection
        </label>
      </div>
      {follow ? (
        <div className="wb-target">
          {target
            ? target.start === target.end
              ? <>after {target.start.toLocaleString()}</>
              : <>{fmtRegion(target)} <span>· {regionLength(target, n).toLocaleString()} bp</span></>
            : hint}
        </div>
      ) : (
        <div className="wb-row wb-range">
          <input
            type="number" className="input ft-input ft-num" min={1} max={n} aria-label={`${label} start`}
            value={target ? target.start + 1 : ''}
            onChange={e => {
              const v = parseInt(e.target.value, 10)
              if (v >= 1 && v <= n) t.setManual({ start: v - 1, end: target?.end ?? Math.min(n, v + 100) })
            }}
          />
          <span>to</span>
          <input
            type="number" className="input ft-input ft-num" min={0} max={n} aria-label={`${label} end`}
            value={target ? target.end : ''}
            onChange={e => {
              const v = parseInt(e.target.value, 10)
              if (v >= 0 && v <= n) t.setManual({ start: target?.start ?? Math.max(0, v - 100), end: v })
            }}
          />
        </div>
      )}
    </>
  )
}
