/**
 * The design settings, collapsed to a one-line summary until opened.
 * Shared by every task; each shows only the fields that mean something to it
 * (product size means nothing to a sequencing primer).
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  BUFFERS, applyBuffer, editSettings, type DesignSettings, type BufferId,
} from '../../../primers/design/settings'

export function SettingsSection({ settings, onChange, product = true, probe = true }: {
  settings: DesignSettings
  onChange: (s: DesignSettings) => void
  /** Show product size (PCR only). */
  product?: boolean
  /** Show the internal-probe option (PCR only). */
  probe?: boolean
}) {
  const [open, setOpen] = useState(false)
  const set = (patch: Partial<DesignSettings>) => onChange(editSettings(settings, patch))
  return (
    <section className="wb-section">
      <button className="wb-disclosure" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Settings
        <span className="wb-disclosure-summary">
          Tm {settings.minTm}–{settings.maxTm} · {settings.minLen}–{settings.maxLen} nt
          {product && ` · ${settings.minProduct}–${settings.maxProduct} bp`}
        </span>
      </button>
      {open && (
        <div className="wb-settings">
          <RangeField label="Tm °C" min={settings.minTm} max={settings.maxTm} opt={settings.optTm}
            onMin={v => set({ minTm: v })} onMax={v => set({ maxTm: v })} onOpt={v => set({ optTm: v })} />
          <RangeField label="Length" min={settings.minLen} max={settings.maxLen}
            onMin={v => set({ minLen: v })} onMax={v => set({ maxLen: v })} />
          <RangeField label="GC %" min={settings.minGC} max={settings.maxGC}
            onMin={v => set({ minGC: v })} onMax={v => set({ maxGC: v })} />
          {product && (
            <RangeField label="Product" min={settings.minProduct} max={settings.maxProduct}
              onMin={v => set({ minProduct: v })} onMax={v => set({ maxProduct: v })} />
          )}
          {probe && (
            <>
              <div className="wb-row">
                <label className="wb-check">
                  <input type="checkbox" checked={settings.probe} onChange={e => set({ probe: e.target.checked })} />
                  Internal probe
                </label>
              </div>
              {settings.probe && (
                <RangeField label="Probe Tm" min={settings.probeMinTm} max={settings.probeMaxTm} opt={settings.probeOptTm}
                  onMin={v => set({ probeMinTm: v })} onMax={v => set({ probeMaxTm: v })} onOpt={v => set({ probeOptTm: v })} />
              )}
            </>
          )}
          <div className="wb-row">
            <label htmlFor="wb-buffer">Buffer</label>
            <select
              id="wb-buffer"
              className="input ft-select"
              value={settings.buffer}
              onChange={e => onChange(applyBuffer(settings, e.target.value as BufferId))}
            >
              {BUFFERS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
              {settings.buffer === 'custom' && <option value="custom">Custom</option>}
            </select>
          </div>
          <div className="wb-conc">
            <NumField label="Na⁺/K⁺ mM" value={settings.naConc} onChange={v => set({ naConc: v })} />
            <NumField label="Mg²⁺ mM" value={settings.mgConc} step={0.1} onChange={v => set({ mgConc: v })} />
            <NumField label="dNTP mM" value={settings.dntpConc} step={0.1} onChange={v => set({ dntpConc: v })} />
            <NumField label="Oligo nM" value={settings.primerConc} onChange={v => set({ primerConc: v })} />
          </div>
          <div className="wb-hint">
            Tm: nearest-neighbour (SantaLucia 1998, mismatch tables via Biopython), Owczarzy 2008 salt correction.
          </div>
        </div>
      )}
    </section>
  )
}

export function NumField({ label, value, step = 1, min, onChange }: {
  label: string; value: number; step?: number; min?: number; onChange: (v: number) => void
}) {
  return (
    <label className="wb-num">
      <span>{label}</span>
      <input
        type="number" className="input ft-input ft-num" step={step} min={min} value={value}
        onChange={e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v) }}
      />
    </label>
  )
}

export function RangeField({ label, min, max, opt, onMin, onMax, onOpt }: {
  label: string; min: number; max: number; opt?: number
  onMin: (v: number) => void; onMax: (v: number) => void; onOpt?: (v: number) => void
}) {
  const num = (v: number, set: (v: number) => void, name: string) => (
    <input
      type="number" className="input ft-input ft-num" value={v} aria-label={`${label} ${name}`}
      onChange={e => { const x = parseFloat(e.target.value); if (Number.isFinite(x)) set(x) }}
    />
  )
  return (
    <div className="wb-row wb-range">
      <label>{label}</label>
      {num(min, onMin, 'minimum')}
      <span>–</span>
      {num(max, onMax, 'maximum')}
      {opt !== undefined && onOpt && <><span>opt</span>{num(opt, onOpt, 'optimum')}</>}
    </div>
  )
}
