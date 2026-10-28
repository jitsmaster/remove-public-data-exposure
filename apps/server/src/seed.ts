import { buildSeedTargets, describeRegistry } from '@rpde/registry'
import { getDb, closeDb } from './db.ts'

/**
 * Loads the vendored registry into `targets`.
 *
 * Idempotent and safe to re-run after re-vendoring BADBOOL. Targets are never deleted here:
 * `jobs` has a foreign key into them, and an upstream removal (Radaris was dropped over a
 * court order) must not silently orphan a removal you already filed.
 */
const seed = buildSeedTargets()
const db = getDb()

const upsert = db.prepare(`
  INSERT INTO targets (
    id, name, domain, tier, leverage, auth_tier, priority, section, opt_out_url, source,
    source_commit, legal_basis, automation, steps_json, flags_json, links_json, notes, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    name = excluded.name,
    domain = excluded.domain,
    tier = excluded.tier,
    leverage = excluded.leverage,
    auth_tier = excluded.auth_tier,
    priority = excluded.priority,
    section = excluded.section,
    opt_out_url = excluded.opt_out_url,
    source = excluded.source,
    source_commit = excluded.source_commit,
    legal_basis = excluded.legal_basis,
    automation = excluded.automation,
    steps_json = excluded.steps_json,
    flags_json = excluded.flags_json,
    links_json = excluded.links_json,
    notes = excluded.notes
`)

const now = new Date().toISOString()
let written = 0
const failures: Array<{ id: string; error: string }> = []

db.exec('BEGIN')
try {
  for (const t of seed) {
    try {
      upsert.run(
        t.id,
        t.name,
        t.domain,
        t.tier,
        t.leverage,
        t.authTier,
        t.priority,
        t.section,
        t.optOutUrl,
        t.source,
        t.sourceCommit,
        t.legalBasis,
        t.automation,
        t.steps ? JSON.stringify(t.steps) : null,
        t.flags ? JSON.stringify(t.flags) : null,
        t.links ? JSON.stringify(t.links) : null,
        t.notes,
        now,
      )
      written += 1
    } catch (error) {
      failures.push({ id: t.id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}

const summary = describeRegistry()
const inDb = Number((db.prepare('SELECT COUNT(*) AS n FROM targets').get() as { n: number }).n ?? 0)
const seedIds = new Set(seed.map((t) => t.id))
const allIds = (db.prepare('SELECT id FROM targets').all() as Array<{ id: string }>).map(
  (r) => r.id,
)
const orphaned = allIds.filter((id) => !seedIds.has(id))

console.log(`[seed] wrote ${written}/${seed.length} targets (${inDb} rows in table)`)
console.log(
  `[seed] enforceable=${summary.enforceable} broker=${summary.broker} byPriority=${JSON.stringify(summary.byPriority)}`,
)
if (summary.superseded.length) {
  console.log(`[seed] superseded broker listings: ${summary.superseded.join(', ')}`)
}
if (orphaned.length) {
  console.log(
    `[seed] note: ${orphaned.length} target(s) in DB are no longer upstream (kept — jobs may reference them): ${orphaned.join(', ')}`,
  )
}
if (failures.length) {
  console.error(`[seed] ${failures.length} failure(s):`)
  for (const f of failures) console.error(`  - ${f.id}: ${f.error}`)
  process.exitCode = 1
}

closeDb()
