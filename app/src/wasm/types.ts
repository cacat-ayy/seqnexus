/**
 * Configuration and types for WebAssembly bioinformatics tools.
 *
 * Tools are lazy-loaded on first use and cached in IndexedDB for offline access.
 */

export interface WasmToolConfig {
  /** Tool identifier. */
  name: string
  /** Semantic version string. */
  version: string
  /** Relative URL to the .js glue file (Emscripten module). */
  jsUrl: string
  /** Relative URL to the .wasm binary. */
  wasmUrl: string
  /** IndexedDB cache key. */
  cacheKey: string
  /** Approximate download size in bytes (for UI display). */
  approxSize: number
}

export interface WasmRunResult {
  stdout: string
  stderr: string
  exitCode: number
}

export type MsaEngine = 'auto' | 'mafft' | 'builtin'


