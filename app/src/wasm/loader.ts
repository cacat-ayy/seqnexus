/**
 * WASM tool loader with IndexedDB caching.
 *
 * Fetches Emscripten-compiled tools, caches the .wasm binary for offline use,
 * and provides an interface to run them with virtual filesystem I/O.
 */

import type { WasmToolConfig, WasmRunResult } from './types'
import { hasCached, getCached, putCached } from '../storage/wasm-cache'

/** Check if a tool's WASM binary and JS glue are cached for offline use. */
export async function isToolCached(config: WasmToolConfig): Promise<boolean> {
  const [hasWasm, hasJs] = await Promise.all([
    hasCached(config.cacheKey),
    hasCached(config.cacheKey + '-js'),
  ])
  return hasWasm && hasJs
}

/**
 * Load a WASM tool: fetch the .wasm binary and JS glue (from IndexedDB
 * cache or biowasm CDN), and return a run function.
 *
 * @param config Tool configuration
 * @param onProgress Optional callback for download progress (0-1)
 * @returns A function to run the tool with arguments and input files
 */
export async function loadTool(
  config: WasmToolConfig,
  onProgress?: (fraction: number) => void,
): Promise<(args: string[], inputFiles?: { name: string; content: string }[]) => Promise<WasmRunResult>> {

  // 1. Get WASM binary (cache first, then CDN)
  let wasmBinary = await getCached(config.cacheKey)
  if (!wasmBinary) {
    wasmBinary = await fetchWithProgress(config.wasmUrl, onProgress)
    await putCached(config.cacheKey, wasmBinary)
  } else {
    onProgress?.(1)
  }

  // 2. Get JS glue (cache first, then CDN)
  const jsCacheKey = config.cacheKey + '-js'
  const cachedJs = await getCached(jsCacheKey)
  let jsText: string
  if (cachedJs) {
    jsText = new TextDecoder().decode(cachedJs)
  } else {
    const jsResponse = await fetch(config.jsUrl)
    if (!jsResponse.ok) throw new Error(`Failed to fetch ${config.jsUrl}: ${jsResponse.status}`)
    jsText = await jsResponse.text()
    await putCached(jsCacheKey, new TextEncoder().encode(jsText).buffer)
  }

  // 3. Return a run function that instantiates the module each time
  //    (Emscripten modules are single-use after callMain)
  return async (args: string[], inputFiles?: { name: string; content: string }[]) => {
    return runEmscriptenModule(jsText, wasmBinary!, args, inputFiles)
  }
}

/** Fetch a URL with progress tracking. */
async function fetchWithProgress(
  url: string,
  onProgress?: (fraction: number) => void,
): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)

  const contentLength = response.headers.get('content-length')
  if (!contentLength || !response.body) {
    onProgress?.(1)
    return response.arrayBuffer()
  }

  const total = parseInt(contentLength, 10)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress?.(received / total)
  }

  const result = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result.buffer
}

/**
 * Instantiate and run an Emscripten module.
 *
 * Creates a fresh module instance, mounts input files, calls main(),
 * and captures stdout/stderr.
 */
async function runEmscriptenModule(
  jsGlueText: string,
  wasmBinary: ArrayBuffer,
  args: string[],
  inputFiles?: { name: string; content: string }[],
): Promise<WasmRunResult> {
  const stdoutChunks: string[] = []
  const stderrChunks: string[] = []
  let exitCode = 0

  // Create the module factory from the JS glue text
  // The glue defines `var Module = (function() { ... })()` which is a factory
  // eslint-disable-next-line no-new-func
  const factory = new Function(`
    var module = { exports: {} };
    var exports = module.exports;
    var define = undefined;
    ${jsGlueText}
    return module.exports || Module;
  `)()

  // Instantiate the module
  const instance = await factory({
    wasmBinary: wasmBinary.slice(0), // copy — Emscripten detaches the buffer
    noInitialRun: true,
    print: (text: string) => { stdoutChunks.push(text) },
    printErr: (text: string) => { stderrChunks.push(text) },
    quit: (code: number) => { exitCode = code },
    // Suppress Emscripten's default stdin (prompt()) / confirm() / alert()
    stdin: () => null,
    // Prevent Emscripten from trying to locate files relative to script
    locateFile: (path: string) => path,
  })

  // Mount input files
  if (inputFiles) {
    for (const f of inputFiles) {
      instance.FS.writeFile(f.name, f.content)
    }
  }

  // Run
  try {
    instance.callMain(args)
  } catch (e: unknown) {
    // Emscripten throws on exit(0) in some builds
    if (e instanceof Error && e.message?.includes('exit')) {
      // Normal exit
    } else {
      throw e
    }
  }

  return {
    stdout: stdoutChunks.join('\n'),
    stderr: stderrChunks.join('\n'),
    exitCode,
  }
}
