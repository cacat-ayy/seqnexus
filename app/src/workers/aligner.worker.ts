/**
 * Runs one alignment tool (a biowasm WebAssembly build) off the main thread.
 * One worker per job: cancelling terminates it, which is the only way to stop
 * a WebAssembly program part-way.
 */

import { runTool, type ToolRun } from '../msa/engines/emscripten'

interface Job {
  glueUrl: string
  wasmUrl: string
  run: ToolRun
}

async function fetchOk(url: string): Promise<Response> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Could not load ${url.split('/').pop()} (${r.status})`)
  return r
}

self.onmessage = async (e: MessageEvent<Job>) => {
  const { glueUrl, wasmUrl, run } = e.data
  try {
    const [glue, wasm] = await Promise.all([
      fetchOk(glueUrl).then(r => r.text()),
      fetchOk(wasmUrl).then(r => r.arrayBuffer()),
    ])
    const result = await runTool(glue, wasm, run)
    self.postMessage({ ok: true, result })
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
