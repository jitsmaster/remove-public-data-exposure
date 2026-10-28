/**
 * Minimal static server for the built PWA shell, with SPA fallback.
 *
 * Why this exists: `adapter-static` with `fallback: 'index.html'` emits a single shell, so a
 * hard load of `/settings` needs to fall back to `index.html` or SvelteKit's router never boots.
 * `python3 -m http.server` will 404 there, which looks like an app bug during a handoff test.
 *
 * Usage: node scripts/serve-shell.mjs [port] [--dir apps/pwa/build]
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const args = process.argv.slice(2)
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 4173)
const dirFlag = args.indexOf('--dir')
const root = resolve(dirFlag >= 0 ? (args[dirFlag + 1] ?? 'apps/pwa/build') : 'apps/pwa/build')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

/** Never cache the service worker or the shell; Chrome will otherwise serve a stale SW forever. */
function headersFor(path) {
  const base = path.split('/').pop() ?? ''
  const noCache = base === 'service-worker.js' || path.endsWith('.html')
  return {
    'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
    'cache-control': noCache ? 'no-store' : 'public, max-age=300',
    // The shell is served on a private tailnet origin but keep the surface tight anyway.
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  }
}

async function readIfFile(candidate) {
  const safe = normalize(candidate)
  if (!safe.startsWith(root)) return null
  try {
    const info = await stat(safe)
    if (!info.isFile()) return null
    return await readFile(safe)
  } catch {
    return null
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const pathname = decodeURIComponent(url.pathname)

  const direct = await readIfFile(join(root, pathname))
  if (direct) {
    res.writeHead(200, headersFor(pathname))
    res.end(direct)
    return
  }

  // SPA fallback.
  const shell = (await readIfFile(join(root, 'index.html'))) ?? Buffer.from('not found', 'utf8')
  res.writeHead(shell.length ? 200 : 404, headersFor('/index.html'))
  res.end(shell)
}).listen(port, '127.0.0.1', () => {
  console.log(`[shell] serving ${root} at http://127.0.0.1:${port}`)
})
