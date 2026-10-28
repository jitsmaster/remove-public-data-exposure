import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AuthTier, Leverage, Tier } from '@rpde/shared'

/**
 * Target registry: two sources, one deduplicated list.
 *
 * - `badbool.json` — derived from BADBOOL (CC BY-NC-SA 4.0, see vendor/badbool/PROVENANCE.md)
 * - `enforceable.json` — hand-authored, US federal law
 *
 * Where both describe the same domain, the enforceable entry wins: it carries a statutory
 * basis, and two targets on one domain would produce duplicate jobs.
 */

const DATA_DIR = join(import.meta.dirname, '..', 'data')

export interface RegistrySource {
  name: string
  repo?: string
  commit?: string
  license?: string
  author?: string
  authority?: string
  note?: string
  warning?: string
}

export interface BadboolEntry {
  id: string
  name: string
  section: string | null
  domain: string
  optOutUrl: string
  leverage: 'crucial' | 'high' | 'normal'
  authTier: AuthTier
  flags: Record<string, boolean>
  notes: string
  additionalLinks: Array<{ text: string; url: string }>
}

export interface BadboolFile {
  source: RegistrySource
  tally: Record<string, unknown>
  entries: BadboolEntry[]
}

export interface EnforceableEntry {
  id: string
  name: string
  domain: string
  legalBasis: string
  removes: string
  optOutUrl: string
  automation: 'none-interactive' | 'partial' | 'manual'
  revocable: boolean
  cost: string
  steps: string[]
}

export interface EnforceableFile {
  source: RegistrySource
  entries: EnforceableEntry[]
}

/** Normalised target, ready to upsert into the `targets` table. */
export interface SeedTarget {
  id: string
  name: string
  domain: string
  tier: Tier
  leverage: Leverage
  /** 0 = crucial / statutorily enforceable, 1 = high priority, 2 = tail. */
  priority: number
  authTier: AuthTier
  section: string | null
  optOutUrl: string
  source: 'badbool' | 'enforceable'
  sourceCommit: string | null
  legalBasis: string | null
  automation: string | null
  steps: string[] | null
  flags: Record<string, boolean> | null
  links: Array<{ text: string; url: string }> | null
  notes: string | null
}

const PRIORITY = { crucial: 0, high: 1, normal: 2 } as const

export function loadBadbool(): BadboolFile {
  return JSON.parse(readFileSync(join(DATA_DIR, 'badbool.json'), 'utf8')) as BadboolFile
}

export function loadEnforceable(): EnforceableFile {
  return JSON.parse(readFileSync(join(DATA_DIR, 'enforceable.json'), 'utf8')) as EnforceableFile
}

function normaliseDomain(domain: string): string {
  return domain.replace(/^www\./, '').toLowerCase()
}

export function buildSeedTargets(): SeedTarget[] {
  const enforceable = loadEnforceable()
  const badbool = loadBadbool()

  const enforceableDomains = new Set(enforceable.entries.map((e) => normaliseDomain(e.domain)))

  const fromEnforceable: SeedTarget[] = enforceable.entries.map((e) => ({
    id: e.id,
    name: e.name,
    domain: normaliseDomain(e.domain),
    tier: 'enforceable',
    leverage: 'high',
    priority: 0,
    // Freezes and opt-outs in this tier verify identity by design; nothing here is a
    // challenge to be automated away.
    authTier: 'id-required',
    section: 'Enforceable (US federal law)',
    optOutUrl: e.optOutUrl,
    source: 'enforceable',
    sourceCommit: null,
    legalBasis: e.legalBasis,
    automation: e.automation,
    steps: e.steps,
    flags: null,
    links: null,
    notes: e.removes,
  }))

  const fromBadbool: SeedTarget[] = []
  const superseded: string[] = []

  // BADBOOL sometimes has two entries whose opt-out resolves to one domain — FreePeopleDirectory
  // points at spokeo.com because Spokeo owns it. One form means one target, so merge them and
  // keep the other names visible instead of silently dropping one.
  const byDomain = new Map<string, BadboolEntry[]>()
  for (const e of badbool.entries) {
    const domain = normaliseDomain(e.domain)
    if (enforceableDomains.has(domain)) {
      superseded.push(`${e.id} (${domain}) — owned by enforceable tier`)
      continue
    }
    const bucket = byDomain.get(domain)
    if (bucket) bucket.push(e)
    else byDomain.set(domain, [e])
  }

  for (const [domain, group] of byDomain) {
    const ranked = [...group].sort(
      (a, b) =>
        PRIORITY[a.leverage] - PRIORITY[b.leverage] ||
        b.additionalLinks.length - a.additionalLinks.length ||
        a.name.localeCompare(b.name),
    )
    const primary = ranked[0]
    if (!primary) continue
    const others = ranked.slice(1).map((e) => e.name)
    if (others.length) {
      superseded.push(`${others.join(', ')} → merged into ${primary.id} (same domain ${domain})`)
    }

    fromBadbool.push({
      id: primary.id,
      name: others.length ? `${primary.name} (also ${others.join(', ')})` : primary.name,
      domain,
      tier: 'broker',
      leverage: primary.leverage === 'normal' ? 'normal' : 'high',
      priority: PRIORITY[primary.leverage],
      authTier: primary.authTier,
      section: primary.section,
      optOutUrl: primary.optOutUrl,
      source: 'badbool',
      sourceCommit: badbool.source.commit ?? null,
      legalBasis: null,
      automation: null,
      steps: null,
      flags: primary.flags,
      links: primary.additionalLinks,
      notes: primary.notes,
    })
  }

  return [...fromEnforceable, ...fromBadbool].sort(
    (a, b) => a.priority - b.priority || a.name.localeCompare(b.name),
  )
}

export function describeRegistry(): {
  total: number
  enforceable: number
  broker: number
  byPriority: Record<number, number>
  superseded: string[]
} {
  const targets = buildSeedTargets()
  const enforceable = loadEnforceable().entries
  const badbool = loadBadbool().entries
  const enforceableDomains = new Set(enforceable.map((e) => normaliseDomain(e.domain)))

  return {
    total: targets.length,
    enforceable: targets.filter((t) => t.tier === 'enforceable').length,
    broker: targets.filter((t) => t.tier === 'broker').length,
    byPriority: targets.reduce<Record<number, number>>((acc, t) => {
      acc[t.priority] = (acc[t.priority] ?? 0) + 1
      return acc
    }, {}),
    superseded: badbool
      .filter((e) => enforceableDomains.has(normaliseDomain(e.domain)))
      .map((e) => `${e.id} (${e.domain})`),
  }
}
