/**
 * Asserts the orchestrator's database cannot be holding the subject's personal data.
 *
 * The risk this guards is specific: a worker writing something it saw on a broker page into
 * `jobs`, `observations`, or `submissions`. The worker is allowed to hold PII in RAM for the
 * duration of a batch (DESIGN.md §5.2); it is not allowed to leave any of it on disk.
 *
 * So the checks are scoped by table class, not applied blindly:
 *
 *   1. SHAPE    — every table's columns are inspected for names that could hold a person's
 *                 name, address, phone, DOB or email.
 *   2. CONTENT  — every text value in RUNTIME tables is scanned for email / phone / SSN
 *                 shapes. Registry tables are exempt: `targets` is regenerated from public
 *                 vendored data and legitimately contains broker support addresses and
 *                 broker phone numbers.
 *   3. TERMS    — if a terms file is supplied, every table is substring-searched for the
 *                 actual identity values. This is the real test, and it needs the terms to
 *                 come from somewhere that is not the repo.
 *
 * Findings never echo the matched value — this output goes to terminals and CI logs, and
 * printing the thing you are trying to protect is a self-inflicted leak.
 *
 * Usage:
 *   node scripts/pii-scan.mjs [db-path] [--terms-file path]
 *   PII_TERMS="term1,term2" node scripts/pii-scan.mjs
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const dbPath = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'))
const termsFlag = args.indexOf('--terms-file')

const DEFAULT_DB = 'apps/server/data/rpde.sqlite'
const resolvedDb = dbPath ?? DEFAULT_DB

/** Tables written at runtime. These must never carry the subject's identity. */
const RUNTIME_TABLES = new Set([
  'subjects',
  'jobs',
  'observations',
  'submissions',
  'push_subscriptions',
])

/** Columns whose presence anywhere implies a design violation. */
const FORBIDDEN_COLUMNS = [
  'email',
  'e_mail',
  'email_address',
  'address',
  'address1',
  'address_line1',
  'street',
  'phone',
  'phone_number',
  'dob',
  'date_of_birth',
  'birthdate',
  'ssn',
  'social_security',
  'full_name',
  'first_name',
  'last_name',
  'subject_name',
  'identity',
  'identity_json',
]

/** Documented exception: `targets.name` is a broker's name. */
const ALLOWED_COLUMNS = new Set(['targets.name'])

const PATTERNS = [
  { label: 'email', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  { label: 'phone', re: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/ },
  { label: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/ },
]

function loadTerms() {
  const fromEnv = process.env['PII_TERMS']
  const terms = []

  if (fromEnv) {
    terms.push(
      ...fromEnv
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    )
  }
  if (termsFlag >= 0) {
    const file = args[termsFlag + 1]
    if (!file || !existsSync(file)) {
      console.error(`[pii-scan] terms file not found: ${file ?? '(none)'}`)
      process.exit(2)
    }
    terms.push(
      ...readFileSync(file, 'utf8')
        .split('\n')
        .map((t) => t.trim())
        .filter((t) => t && !t.startsWith('#')),
    )
  }
  return [...new Set(terms)]
}

if (!existsSync(resolvedDb)) {
  console.error(`[pii-scan] no database at ${resolvedDb}`)
  process.exit(2)
}

const terms = loadTerms()
const db = new DatabaseSync(resolvedDb, { readOnly: true })

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
  .all()
  .map((r) => String(r.name))

const problems = []
let cellsScanned = 0

for (const table of tables) {
  if (table === 'schema_migrations') continue

  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => String(r.name))
  const isRuntime = RUNTIME_TABLES.has(table)

  for (const column of columns) {
    const qualified = `${table}.${column}`
    if (ALLOWED_COLUMNS.has(qualified)) continue
    if (FORBIDDEN_COLUMNS.includes(column.toLowerCase())) {
      problems.push(`SHAPE: ${qualified} can hold personal data`)
    }
  }

  const rows = db.prepare(`SELECT * FROM ${table}`).all()
  for (const row of rows) {
    for (const [column, value] of Object.entries(row)) {
      if (value === null || value === undefined) continue
      if (typeof value !== 'string' && typeof value !== 'number') continue
      const text = String(value)
      cellsScanned += 1

      // CONTENT — runtime tables only.
      if (isRuntime) {
        for (const pattern of PATTERNS) {
          if (pattern.re.test(text)) {
            problems.push(`CONTENT: ${table}.${column} matches ${pattern.label}`)
          }
        }
      }

      // TERMS — every table, because a leaked term anywhere is a leak.
      for (const term of terms) {
        if (term.length >= 4 && text.toLowerCase().includes(term.toLowerCase())) {
          // Report the location only. Never the value.
          problems.push(`TERM: ${table}.${column} contains a supplied identity term`)
        }
      }
    }
  }
}

db.close()

console.log(
  `[pii-scan] ${resolvedDb}: ${tables.length} tables, ${cellsScanned} cells scanned, ` +
    `${terms.length} identity term(s) loaded`,
)

if (!terms.length) {
  console.log(
    '[pii-scan] note: no identity terms supplied — SHAPE and CONTENT only. ' +
      'Set PII_TERMS or --terms-file for the real test.',
  )
}

const unique = [...new Set(problems)]
if (unique.length) {
  console.error(`[pii-scan] FAILED — ${unique.length} finding(s):`)
  for (const p of unique.slice(0, 30)) console.error(`  ${p}`)
  process.exit(1)
}

console.log('[pii-scan] clean')
