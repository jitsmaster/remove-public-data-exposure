/**
 * Re-downloads the vendored BADBOOL snapshot and records its provenance.
 *
 * Run this, review the diff, then `pnpm --filter @rpde/registry build:data`. Never hand-edit
 * `vendor/badbool/README.md` or `data/badbool.json` — upstream corrections should arrive by
 * re-vendoring, otherwise the snapshot silently drifts from its recorded commit.
 *
 * Usage: node scripts/vendor-badbool.mjs
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const REPO = 'yaelwrites/Big-Ass-Data-Broker-Opt-Out-List'
const BRANCH = 'master'
const OUT = 'packages/registry/vendor/badbool'

const FILES = [
  { remote: 'README.md', local: 'README.md' },
  { remote: 'LICENSE.md', local: 'LICENSE-BADBOOL.md' },
]

mkdirSync(OUT, { recursive: true })

const previous = existsSync(join(OUT, 'COMMIT'))
  ? readFileSync(join(OUT, 'COMMIT'), 'utf8').trim()
  : null

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'rpde-registry-vendor' } })
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`)
  return response.text()
}

const commits = await fetch(
  `https://api.github.com/repos/${REPO}/commits?per_page=1&sha=${BRANCH}`,
  { headers: { accept: 'application/vnd.github+json' } },
).then((r) => r.json())

const sha = commits?.[0]?.sha
if (!sha) throw new Error('could not resolve upstream head commit')

for (const file of FILES) {
  const url = `https://raw.githubusercontent.com/${REPO}/${sha}/${file.remote}`
  const body = await fetchText(url)
  writeFileSync(join(OUT, file.local), body)
  const digest = createHash('sha256').update(body).digest('hex')
  console.log(
    `[vendor] ${file.local} <- ${file.remote} (${body.length} bytes, sha256 ${digest.slice(0, 16)}…)`,
  )
}

writeFileSync(join(OUT, 'COMMIT'), `${sha}\n`)

if (previous && previous !== sha) {
  console.log(`[vendor] upstream moved: ${previous.slice(0, 12)} -> ${sha.slice(0, 12)}`)
  console.log('[vendor] review with: git diff packages/registry/vendor packages/registry/data')
} else if (!previous) {
  console.log(`[vendor] pinned at ${sha.slice(0, 12)}`)
} else {
  console.log(`[vendor] unchanged (${sha.slice(0, 12)})`)
}

console.log('[vendor] next: pnpm --filter @rpde/registry build:data')
