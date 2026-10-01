/**
 * Running a biowasm-built command-line tool: instantiate its Emscripten
 * module, put the input files in its in-memory filesystem, call main(), and
 * read back stdout, stderr and output files.
 *
 * The builds are modularized (the glue defines a `Module` factory) and only
 * accept browser or worker environments. A module worker has no
 * `importScripts`, so a stub is put in the glue's scope; that also lets the
 * same code run under Node for tests.
 *
 * A module is single-use after main() returns, so every run starts a fresh
 * instance. That costs a few milliseconds, against seconds of alignment.
 */

export interface ToolRun {
  args: string[]
  /** Files to create before running, by path. */
  files: Record<string, string>
  /** Files to read back afterwards. Missing ones come back as null. */
  outputs: string[]
}

export interface ToolResult {
  exitCode: number
  stdout: string
  stderr: string
  files: Record<string, string | null>
}

type Factory = (config: Record<string, unknown>) => Promise<EmscriptenModule>

interface EmscriptenModule {
  FS: {
    writeFile: (path: string, data: string) => void
    readFile: (path: string, opts: { encoding: 'utf8' }) => string
  }
  callMain: (args: string[]) => number | undefined
}

const factories = new Map<string, Factory>()

/** The module factory defined by a glue script, cached by the script's text. */
export function moduleFactory(glue: string): Factory {
  let f = factories.get(glue)
  if (!f) {
    f = new Function(
      `var module = { exports: {} }; var exports = module.exports; var define = undefined;
       var process = undefined; var require = undefined;
       var importScripts = function () {};
       ${glue}
       return Module;`,
    )() as Factory
    factories.set(glue, f)
  }
  return f
}

/** Is this throw just the program exiting? Emscripten signals exit() with an exception. */
function exitStatus(e: unknown): number | null {
  if (e && typeof e === 'object' && 'status' in e && typeof (e as { status: unknown }).status === 'number') {
    return (e as { status: number }).status
  }
  if (e instanceof Error && /exit\(|ExitStatus|Program terminated/i.test(e.message)) return 0
  return null
}

export async function runTool(
  glue: string,
  wasm: ArrayBuffer | Uint8Array,
  run: ToolRun,
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void,
): Promise<ToolResult> {
  const stdout: string[] = []
  const stderr: string[] = []
  let exitCode = 0
  const binary = wasm instanceof Uint8Array ? wasm.slice() : new Uint8Array(wasm.slice(0))
  const mod = await moduleFactory(glue)({
    wasmBinary: binary,
    noInitialRun: true,
    print: (t: string) => { stdout.push(t); onLine?.(t, 'stdout') },
    printErr: (t: string) => { stderr.push(t); onLine?.(t, 'stderr') },
    quit: (code: number) => { exitCode = code },
    // No interactive input: tools that would prompt read end-of-file.
    stdin: () => null,
    locateFile: (p: string) => p,
  })
  for (const [path, content] of Object.entries(run.files)) mod.FS.writeFile(path, content)
  try {
    const r = mod.callMain(run.args)
    if (typeof r === 'number') exitCode = r
  } catch (e) {
    const status = exitStatus(e)
    if (status === null) {
      // A trap (abort, "unreachable") after the tool printed why: report it as a failed run.
      exitCode = 1
      stderr.push(e instanceof Error ? e.message : String(e))
    } else {
      exitCode = status
    }
  }
  const files: Record<string, string | null> = {}
  for (const path of run.outputs) {
    try { files[path] = mod.FS.readFile(path, { encoding: 'utf8' }) } catch { files[path] = null }
  }
  return { exitCode, stdout: stdout.join('\n'), stderr: stderr.join('\n'), files }
}
