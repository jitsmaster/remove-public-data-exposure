/**
 * Parses the vendored BADBOOL markdown into structured targets.
 *
 * BADBOOL is CC BY-NC-SA 4.0; the output of this script is a derivative work and carries
 * the same licence. See vendor/badbool/PROVENANCE.md.
 *
 * Usage: node scripts/import-badbool.mjs
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'packages/registry'
const VENDOR = join(ROOT, 'vendor', 'badbool')
const OUT = join(ROOT, 'data', 'badbool.json')

const MARKERS = [
  { glyph: '💐', flag: 'crucial', label: 'crucial' },
  { glyph: '☠', flag: 'highPriority', label: 'high priority' },
  { glyph: '🎫', flag: 'requiresId', label: "requires driver's licence / ID" },
  { glyph: '📞', flag: 'requiresPhone', label: 'requires a phone call' },
  { glyph: '💰', flag: 'costsMoney', label: 'charges money' },
]

/** Domains that are never the opt-out destination itself. */
const REFERENCE_HOSTS = new Set([
  'google.com',
  'support.google.com',
  'bing.com',
  'microsoft.com',
  'www.microsoft.com',
  'ko-fi.com',
  'yaelwrites.com',
  'www.yaelwrites.com',
  'consumer.drop.privacy.ca.gov',
  'privacy.ca.gov',
  'github.com',
  'en.wikipedia.org',
  'wikipedia.org',
])

const readme = readFileSync(join(VENDOR, 'README.md'), 'utf8')
const commit = readFileSync(join(VENDOR, 'COMMIT'), 'utf8').trim()
const sha256 = createHash('sha256').update(readme).digest('hex')

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Deprioritise search-engine/reference links when choosing the opt-out destination. */
function pickOptOutUrl(links) {
  const usable = links.filter((l) => !REFERENCE_HOSTS.has(hostOf(l.url) ?? ''))
  const pool = usable.length ? usable : links
  if (!pool.length) return null
  const preferred = pool.find((l) =>
    /opt.?out|privacy|remove|delete|suppress|rights|preference/i.test(l.url),
  )
  return (preferred ?? pool[0]).url
}

/**
 * Auth tier is a best-effort inference from the entry prose. Deliberately conservative:
 * when in doubt we assume *more* friction, because a job that silently fails at a CAPTCHA
 * is worse than one that starts as assisted-manual.
 */
function inferAuthTier(body, flags) {
  if (flags.requiresId || /driver'?s licen[cs]e|photo id|notari[sz]|government.?issued/i.test(body))
    return 'id-required'
  if (/captcha|recaptcha|hcaptcha|turnstile/i.test(body)) return 'captcha'
  if (
    /confirm[^.]{0,40}email|email[^.]{0,40}confirm|click[^.]{0,30}link|sent to you via email|verif\w*[^.]{0,20}email/i.test(
      body,
    )
  )
    return 'email'
  return 'form'
}

/** First two sentences, links stripped, length-capped. Enough to orient a human. */
function summarise(body) {
  const text = body
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .slice(0, 2)
    .join(' ')
  return sentences.length > 320 ? `${sentences.slice(0, 317)}…` : sentences
}

const entries = []
let section = null
let current = null

function flush() {
  if (!current) return
  const flags = Object.fromEntries(MARKERS.map((m) => [m.flag, false]))
  for (const marker of MARKERS) {
    if (current.heading.includes(marker.glyph)) flags[marker.flag] = true
  }

  const name = MARKERS.reduce((acc, m) => acc.replaceAll(m.glyph, ''), current.heading)
    .replace(/\s+/g, ' ')
    .trim()

  const body = current.body.join('\n').trim()
  const links = [...body.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => ({
    text: m[1],
    url: m[2],
  }))

  const optOutUrl = pickOptOutUrl(links)
  if (!name || !optOutUrl) {
    current = null
    return
  }

  const leverage = flags.crucial ? 'crucial' : flags.highPriority ? 'high' : 'normal'

  entries.push({
    id: slug(name),
    name,
    section,
    domain: hostOf(optOutUrl) ?? '',
    optOutUrl,
    leverage,
    authTier: inferAuthTier(body, flags),
    flags,
    notes: summarise(body),
    additionalLinks: links
      .filter((l) => l.url !== optOutUrl)
      .slice(0, 6)
      .map((l) => ({ text: l.text, url: l.url })),
  })
  current = null
}

for (const line of readme.split('\n')) {
  if (/^## /.test(line)) {
    flush()
    section = line.replace(/^##\s+/, '').trim()
    continue
  }
  if (/^### /.test(line)) {
    flush()
    current = { heading: line.replace(/^###\s+/, ''), body: [] }
    continue
  }
  if (/^# /.test(line)) {
    flush()
    section = null
    continue
  }
  if (current) current.body.push(line)
}
flush()

const seen = new Set()
const deduped = entries.filter((e) => {
  if (seen.has(e.id)) return false
  seen.add(e.id)
  return true
})

const tally = {
  total: deduped.length,
  crucial: deduped.filter((e) => e.leverage === 'crucial').length,
  high: deduped.filter((e) => e.leverage === 'high').length,
  normal: deduped.filter((e) => e.leverage === 'normal').length,
  byAuthTier: Object.fromEntries(
    ['email', 'form', 'captcha', 'id-required'].map((t) => [
      t,
      deduped.filter((e) => e.authTier === t).length,
    ]),
  ),
  bySection: deduped.reduce((acc, e) => {
    const key = e.section ?? '(none)'
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {}),
}

const output = {
  source: {
    name: 'Big Ass Data Broker Opt-Out List (BADBOOL)',
    repo: 'https://github.com/yaelwrites/Big-Ass-Data-Broker-Opt-Out-List',
    commit,
    fileSha256: sha256,
    license: 'CC BY-NC-SA 4.0',
    licenseFile: 'packages/registry/vendor/badbool/LICENSE-BADBOOL.md',
    author: 'Yael Grauer',
    generatedBy: 'scripts/import-badbool.mjs',
    warning:
      'Derived work. CC BY-NC-SA 4.0 — attribution required, non-commercial only, share-alike.',
  },
  tally,
  entries: deduped,
}

writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`)
console.log(`[badbool] ${deduped.length} entries -> ${OUT}`)
console.log(`[badbool] tally`, JSON.stringify(tally))
