import { createReadStream, existsSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, resolve as resolvePath, sep } from 'node:path'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
}

const NOT_BUILT_PAGE = `<!doctype html>
<html><body style="font-family:sans-serif;padding:2rem;max-width:32rem;margin:0 auto">
<h1>Browser client not built</h1>
<p>Run <code>npm run build:web</code> in the electron/ folder, then reload this page.</p>
</body></html>`

/**
 * Sent as a real response header on every response, in addition to the
 * equivalent <meta> tag baked into src/web/index.html — the header covers
 * the placeholder page and any non-HTML response too, and applies before
 * the browser has parsed any HTML at all. Keep in sync with that file's
 * CSP if either changes.
 */
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
} as const

/**
 * Minimal static file server for the browser build (out/web) — no Express,
 * since this app has no other HTTP surface and this is the only thing it
 * needs to do. Any resolved path outside webRoot is rejected outright
 * (never merely normalized) since that's always a bug or an attack, never
 * a legitimate request. Unknown paths fall back to index.html (the browser
 * build is a client-routed single-page app), and a missing webRoot entirely
 * gets a friendly placeholder instead of a bare 404 or ECONNREFUSED, since
 * "the build doesn't exist yet" is expected during development.
 */
export function serveStatic(webRoot: string, req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS }).end('Method Not Allowed')
    return
  }

  if (!existsSync(webRoot)) {
    res
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS })
      .end(NOT_BUILT_PAGE)
    return
  }

  const urlPath = (req.url ?? '/').split('?')[0] ?? '/'
  let relative: string
  try {
    relative = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '')
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS }).end('Bad Request')
    return
  }
  if (relative.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS }).end('Bad Request')
    return
  }

  const rootResolved = resolvePath(webRoot)
  const resolved = resolvePath(rootResolved, relative)
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS }).end('Forbidden')
    return
  }

  let filePath = resolved
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = resolvePath(rootResolved, 'index.html')
  }
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS }).end('Not Found')
    return
  }

  const contentType = CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream'
  const cacheControl = filePath.endsWith('index.html')
    ? 'no-store'
    : 'public, max-age=31536000, immutable'
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    ...SECURITY_HEADERS
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(filePath).pipe(res)
}
