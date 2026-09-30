/**
 * How the gel was poured and run, and how it is imaged.
 */

import { AGAROSE_MAX, AGAROSE_MIN, GEL_FORMATS, resolutionRange } from '../../gel/migration'
import type { GelBuffer, GelConditions, GelFormat } from '../../gel/model'
import { GEL_LOOKS, GEL_LOOK_ORDER, type GelLookId } from '../../gel/render/looks'
import type { GelEffects } from '../../gel/render/raster'
import { formatBp } from '../../gel/render/scene'
import type { GelDisplay, LaneLabelMode } from '../../gel/workspace'

interface Props {
  conditions: GelConditions
  onConditions: (patch: Partial<GelConditions>) => void
  display: GelDisplay
  onDisplay: (patch: Partial<GelDisplay>) => void
}

const EFFECTS: { key: keyof GelEffects; label: string; hint: string }[] = [
  { key: 'grain', label: 'Camera grain', hint: 'Sensor noise' },
  { key: 'uneven', label: 'Uneven staining', hint: 'Patchy background, brighter centre' },
  { key: 'smile', label: 'Smiling bands', hint: 'Bands curve at the lane edges, from uneven heating' },
]

export default function GelSettings({ conditions, onConditions, display, onDisplay }: Props) {
  const [lo, hi] = resolutionRange(conditions)
  return (
    <div className="gw-inspector-body">
      <div className="gw-section-title">Gel</div>
      <label className="gw-field">
        <span className="gw-field-label">Agarose</span>
        <span className="gw-slider">
          <input
            type="range" min={AGAROSE_MIN} max={AGAROSE_MAX} step={0.1}
            value={conditions.agarosePct}
            onChange={e => onConditions({ agarosePct: Number(e.target.value) })}
          />
          <span className="gw-slider-value">{conditions.agarosePct.toFixed(1)}%</span>
        </span>
      </label>
      <div className="gw-field-hint">Separates about {formatBp(lo)} – {formatBp(hi)} well</div>
      <div className="gw-field">
        <span className="gw-field-label">Buffer</span>
        <div className="toggle-group" role="radiogroup" aria-label="Buffer">
          {(['TAE', 'TBE'] as GelBuffer[]).map(b => (
            <button key={b} role="radio" aria-checked={conditions.buffer === b}
              className={`toggle-btn ${conditions.buffer === b ? 'active' : ''}`}
              onClick={() => onConditions({ buffer: b })}>{b}</button>
          ))}
        </div>
      </div>
      <div className="gw-field">
        <span className="gw-field-label">Size</span>
        <div className="toggle-group" role="radiogroup" aria-label="Gel size">
          {(Object.keys(GEL_FORMATS) as GelFormat[]).map(f => (
            <button key={f} role="radio" aria-checked={conditions.format === f}
              className={`toggle-btn ${conditions.format === f ? 'active' : ''}`}
              title={GEL_FORMATS[f].label}
              onClick={() => onConditions({ format: f })}>{f[0].toUpperCase() + f.slice(1)}</button>
          ))}
        </div>
      </div>
      <label className="gw-field" title="How far the bromophenol blue front has run down the gel">
        <span className="gw-field-label">Run</span>
        <span className="gw-slider">
          <input
            type="range" min={0.3} max={1} step={0.05}
            value={conditions.dyeFront}
            onChange={e => onConditions({ dyeFront: Number(e.target.value) })}
          />
          <span className="gw-slider-value">{Math.round(conditions.dyeFront * 100)}%</span>
        </span>
      </label>
      <div className="gw-field-hint">Where the blue loading dye has got to</div>

      <div className="gw-section-title">Image</div>
      <label className="gw-field">
        <span className="gw-field-label">Look</span>
        <select className="select gw-select" value={display.look}
          onChange={e => onDisplay({ look: e.target.value as GelLookId })}>
          {GEL_LOOK_ORDER.map(id => <option key={id} value={id}>{GEL_LOOKS[id].label}</option>)}
        </select>
      </label>
      <label className="gw-field">
        <span className="gw-field-label">Exposure</span>
        <span className="gw-slider">
          <input
            type="range" min={-2} max={2} step={0.25}
            value={display.exposure}
            onChange={e => onDisplay({ exposure: Number(e.target.value) })}
          />
          <span className="gw-slider-value">{display.exposure > 0 ? '+' : ''}{display.exposure}</span>
        </span>
      </label>
      <div className="gw-field">
        <span className="gw-field-label">Labels</span>
        <div className="toggle-group" role="radiogroup" aria-label="Lane labels">
          {(['numbers', 'names'] as LaneLabelMode[]).map(m => (
            <button key={m} role="radio" aria-checked={display.labelMode === m}
              className={`toggle-btn ${display.labelMode === m ? 'active' : ''}`}
              onClick={() => onDisplay({ labelMode: m })}>{m === 'numbers' ? 'Numbers' : 'Names'}</button>
          ))}
        </div>
      </div>
      <label className="gw-check" title="Heavily loaded bands grow thicker, as on a real gel">
        <input type="checkbox" checked={display.massThickness} onChange={e => onDisplay({ massThickness: e.target.checked })} />
        Band thickness by mass
      </label>
      <label className="gw-check" title="Show where the loading dyes have run to">
        <input type="checkbox" checked={display.showDyeFronts} onChange={e => onDisplay({ showDyeFronts: e.target.checked })} />
        Loading dye fronts
      </label>

      <div className="gw-section-title">Realism effects</div>
      {EFFECTS.map(fx => (
        <label key={fx.key} className="gw-check" title={fx.hint}>
          <input
            type="checkbox"
            checked={display.effects[fx.key]}
            onChange={() => onDisplay({ effects: { ...display.effects, [fx.key]: !display.effects[fx.key] } })}
          />
          {fx.label}
        </label>
      ))}
    </div>
  )
}
