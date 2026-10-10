/**
 * Loading 3Dmol.js on first use.
 *
 * The library ships beside app.html as a plain script (vite.config.ts,
 * vendorScripts) and is added with a script tag the first time a structure
 * is shown, so it costs nothing until then and loads over file:// as well
 * as http. It defines the global $3Dmol. Only the calls the viewer makes are
 * typed here.
 */

export interface AtomSpec {
  chain?: string
  resi?: number
  resn?: string
  atom?: string
  b?: number
  hetflag?: boolean
  x?: number
  y?: number
  z?: number
}

export type AtomSelection = Record<string, unknown>

export interface Viewer3D {
  addModel(data: string, format: string): unknown
  clear(): void
  setStyle(sel: AtomSelection, style: Record<string, unknown>): void
  addStyle(sel: AtomSelection, style: Record<string, unknown>): void
  addSurface(type: unknown, style: Record<string, unknown>, sel?: AtomSelection, allSel?: AtomSelection): unknown
  removeAllSurfaces(): void
  setHoverable(sel: AtomSelection, hoverable: boolean, onHover: (atom: AtomSpec) => void, onUnhover: (atom: AtomSpec) => void): void
  setHoverDuration(ms: number): void
  setClickable(sel: AtomSelection, clickable: boolean, onClick: (atom: AtomSpec) => void): void
  setBackgroundColor(color: string, alpha?: number): void
  zoomTo(sel?: AtomSelection, ms?: number): void
  zoom(factor: number, ms?: number): void
  render(): void
  resize(): void
  pngURI(): string
  spin(axis: string | boolean): void
}

export interface ThreeDmol {
  createViewer(element: HTMLElement, config?: Record<string, unknown>): Viewer3D
  SurfaceType: { VDW: unknown; SAS: unknown; MS: unknown; SES: unknown }
}

declare global {
  interface Window { $3Dmol?: ThreeDmol }
}

let loading: Promise<ThreeDmol> | null = null

export function load3Dmol(): Promise<ThreeDmol> {
  if (window.$3Dmol) return Promise.resolve(window.$3Dmol)
  if (loading) return loading
  loading = new Promise<ThreeDmol>((resolve, reject) => {
    const script = document.createElement('script')
    // Relative to app.html, which the build puts beside the script.
    script.src = `./${__THREEDMOL_FILE__}`
    script.async = true
    script.onload = () => (window.$3Dmol ? resolve(window.$3Dmol) : reject(new Error('3Dmol.js loaded but did not start')))
    script.onerror = () => {
      loading = null
      script.remove()
      reject(new Error(`Could not load the structure viewer (${__THREEDMOL_FILE__} is missing beside app.html).`))
    }
    document.head.appendChild(script)
  })
  return loading
}
