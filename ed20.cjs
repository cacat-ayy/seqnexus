const fs = require('fs')
const p = 'app/src/hooks/useFileImport.ts'
let s = fs.readFileSync(p, 'utf8')
const rep = (a, b) => { if (!s.includes(a)) throw new Error(a.slice(0, 60)); s = s.replace(a, b) }
rep(`    const report = all.length > 1 ? batchReporter() : directReporter`, `    const batch = all.length > 1 ? batchReporter() : null
    const report = batch ?? directReporter`)
rep(`    if ('finish' in report) void Promise.allSettled(jobs).then(() => report.finish(opened))`, `    if (batch) void Promise.allSettled(jobs).then(() => batch.finish(opened))`)
rep(`  const handleFileOpen = useCallback(async (file: File, ctx: OpenContext = {}): Promise<void> => {
    const report = ctx.report ?? directReporter`, `  const handleFileOpen = useCallback((given: File, ctx: OpenContext = {}): Promise<void> => {
    const report = ctx.report ?? directReporter
    const run = async (file: File): Promise<void> => {`)
rep(`        const bytes = gunzipSync(new Uint8Array(await readFile(file, 'buffer')))
        await handleFileOpen(new File([bytes], file.name.replace(/\.gz$/i, '')), ctx)`, `        const bytes = gunzipSync(new Uint8Array(await readFile(file, 'buffer')))
        await run(new File([bytes], file.name.replace(/\.gz$/i, '')))`)
rep(`      openText(await readFile(file, 'text'), file.name, false, ctx)
    } catch (err) {
      fail(err)
    }
  }, [openText, openDocsInFolder, openGeneious, trackParse])`, `      openText(await readFile(file, 'text'), file.name, false, ctx)
    } catch (err) {
      fail(err)
    }
    }
    return run(given)
  }, [openText, openDocsInFolder, openGeneious, trackParse])`)
fs.writeFileSync(p, s)
