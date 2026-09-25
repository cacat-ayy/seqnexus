/**
 * Local review server for the built site.
 *
 * `vite preview` would work, but build.outDir is the repository root, so it
 * would also serve .git/, app/src/ and app/node_modules/. This serves only the
 * files that actually get published, from an explicit allowlist, with no
 * directory listing and no path traversal.
 *
 *   node app/scripts/review-server.mjs [port]
 */

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const port = Number(process.argv[2] ?? 8000)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
}

/**
 * Only these may be served. Everything published lives at the repo root
 * alongside a lot that must not be — hence an allowlist rather than a denylist.
 */
const ALLOWED_FILES = new Set([
  'index.html', 'app.html', 'impressum.html', 'datenschutz.html',
  'robots.txt', 'sitemap.xml',
])
const ALLOWED_DIRS = ['assets/', 'wasm/']
const ALLOWED_PATTERNS = [/^[A-Za-z-]+\.worker-[A-Za-z0-9_-]+\.js$/]

function isAllowed(rel) {
  if (ALLOWED_FILES.has(rel)) return true
  if (ALLOWED_DIRS.some(d => rel.startsWith(d))) return true
  return ALLOWED_PATTERNS.some(p => p.test(rel))
}

const server = createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0]
  const rel = url === '/' ? 'index.html' : decodeURIComponent(url).replace(/^\/+/, '')

  const file = resolve(siteRoot, rel)
  // Reject anything that escapes the site root, even after symlink-free resolve.
  const within = relative(siteRoot, file)
  if (within.startsWith('..') || within.startsWith(sep)) {
    res.writeHead(403).end('Forbidden')
    return
  }

  if (!isAllowed(rel)) {
    res.writeHead(404).end(`Not served: ${rel}`)
    return
  }

  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file')
    const body = await readFile(file)
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      // Always revalidate: this is a review server, stale bytes defeat the point.
      'Cache-Control': 'no-store',
    })
    res.end(body)
  } catch {
    res.writeHead(404).end('Not found')
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`SeqNexus review server`)
  console.log(`  landing page : http://localhost:${port}/`)
  console.log(`  editor       : http://localhost:${port}/app.html`)
  console.log(`  serving      : ${siteRoot} (published files only)`)
})
