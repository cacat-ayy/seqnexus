/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = dirname(fileURLToPath(import.meta.url))
// The repo root doubles as the web root: GitHub Pages serves it at seqnexus.app.
// The build writes app.html (plus its worker chunks) straight into it.
const siteRoot = resolve(appDir, '..')

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
}

/**
 * Serve the hand-written landing page and its assets from the repo root during
 * dev, so the dev server mirrors production: / is the landing page, /app.html
 * is the editor. Registered as post-middleware, so Vite still owns /app.html
 * and /src/* — only paths Vite does not handle fall through to here.
 */
function serveSiteRoot(): Plugin {
  return {
    name: 'serve-site-root',
    apply: 'serve',
    configureServer(server) {
      return () => {
        server.middlewares.use((req, res, next) => {
          // originalUrl, not url: Vite's html fallback runs before this and
          // rewrites req.url to '/index.html' for requests it cannot resolve.
          // Reading req.url therefore served the landing page for every
          // missing path, including /assets/*.png, which looked like a 200
          // but delivered HTML where an image was expected.
          const raw = (req as { originalUrl?: string }).originalUrl ?? req.url ?? '/'
          const url = raw.split('?')[0]
          // Never shadow the app itself — Vite builds that from source.
          if (url === '/app.html') return next()
          const rel = url === '/' ? 'index.html' : decodeURIComponent(url).replace(/^\/+/, '')
          const file = resolve(siteRoot, rel)
          // Keep traversal inside the repo root.
          if (file !== siteRoot && !file.startsWith(siteRoot + '/')) return next()
          if (!existsSync(file) || !statSync(file).isFile()) return next()
          res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream')
          res.end(readFileSync(file))
        })
      }
    },
  }
}

/**
 * Worker chunks are emitted with content hashes, so a rebuild leaves the
 * previous build's copies behind in the repo root. outDir is never emptied
 * (it is the repo root), so prune them explicitly instead.
 */
function cleanStaleWorkers(): Plugin {
  return {
    name: 'clean-stale-workers',
    apply: 'build',
    buildStart() {
      for (const f of readdirSync(siteRoot)) {
        if (/\.worker-[A-Za-z0-9_-]+\.js$/.test(f)) rmSync(resolve(siteRoot, f))
      }
    },
  }
}

/**
 * app.html carries a developer-facing comment explaining that it is the Vite
 * entry rather than a copy of the built ../app.html. Strip HTML comments from
 * the built output so that note is not shipped to every visitor.
 */
function stripEntryComments(): Plugin {
  return {
    name: 'strip-entry-comments',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace(/<!--[\s\S]*?-->\s*/g, ''),
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    viteSingleFile(),
    serveSiteRoot(),
    cleanStaleWorkers(),
    stripEntryComments(),
  ],
  server: {
    host: '0.0.0.0',
    port: 8000,
    // Dev containers (Ona/Gitpod) expose the server through a generated
    // <port>--<workspace>.<region>.flexdev.roche.com hostname. The leading dot
    // allows that domain and all its subdomains, so the workspace id and port
    // can change without touching this file.
    allowedHosts: ['.flexdev.roche.com'],
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    // Publish in place: app.html and its worker chunks land in the web root.
    outDir: siteRoot,
    // Must stay false — emptying outDir here would delete the whole repo.
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(appDir, 'app.html'),
    },
  },
  esbuild: {
    legalComments: 'none',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
  },
})
