/// <reference lib="webworker" />
import { runAssembly, type AssemblyMessage, type AssemblyRequest } from '../assembly/run'

self.onmessage = (e: MessageEvent<AssemblyRequest>) => {
  let last = 0
  try {
    const report = runAssembly(e.data, (done, total) => {
      const now = Date.now()
      if (now - last < 80 && done < total) return
      last = now
      self.postMessage({ type: 'progress', done, total } satisfies AssemblyMessage)
    })
    self.postMessage({ type: 'done', report } satisfies AssemblyMessage)
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies AssemblyMessage)
  }
}
