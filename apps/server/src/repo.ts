import { randomUUID } from 'node:crypto'
import type {
  Job,
  JobStatus,
  Observation,
  ObservationResult,
  StatsResponse,
  Target,
} from '@rpde/shared'
import { getDb } from './db.ts'

/**
 * All SQL lives here. Note what is absent: no column, query, or parameter in this file can
 * carry a name, address, phone number, date of birth, or email address. That is the
 * enforcement of DESIGN.md §5.2 at the data-access layer.
 */

type Row = Record<string, unknown>

const TARGET_COLUMNS = `
  id, name, domain, tier, leverage, auth_tier, priority, section, opt_out_url, source,
  source_commit, legal_basis, automation, steps_json, flags_json, links_json, adapter,
  badbool_version, notes
`

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function toTarget(row: Row): Target {
  return {
    id: String(row['id']),
    name: String(row['name']),
    domain: String(row['domain']),
    tier: row['tier'] as Target['tier'],
    leverage: row['leverage'] as Target['leverage'],
    authTier: row['auth_tier'] as Target['authTier'],
    priority: Number(row['priority'] ?? 2),
    section: (row['section'] as string | null) ?? null,
    optOutUrl: String(row['opt_out_url'] ?? ''),
    source: (row['source'] as Target['source']) ?? 'badbool',
    sourceCommit: (row['source_commit'] as string | null) ?? null,
    legalBasis: (row['legal_basis'] as string | null) ?? null,
    automation: (row['automation'] as string | null) ?? null,
    steps: parseJson<string[]>(row['steps_json']),
    flags: parseJson<Record<string, boolean>>(row['flags_json']),
    links: parseJson<Array<{ text: string; url: string }>>(row['links_json']),
    ...(row['adapter'] ? { adapter: String(row['adapter']) } : {}),
    ...(row['badbool_version'] ? { badboolVersion: String(row['badbool_version']) } : {}),
    ...(row['notes'] ? { notes: String(row['notes']) } : {}),
  }
}

export interface TargetFilters {
  tier?: string
  leverage?: string
  authTier?: string
  priority?: number
  search?: string
  limit?: number
}

export function listTargets(filters: TargetFilters = {}): Target[] {
  const where: string[] = []
  const params: Array<string | number> = []

  if (filters.tier) {
    where.push('tier = ?')
    params.push(filters.tier)
  }
  if (filters.leverage) {
    where.push('leverage = ?')
    params.push(filters.leverage)
  }
  if (filters.authTier) {
    where.push('auth_tier = ?')
    params.push(filters.authTier)
  }
  if (typeof filters.priority === 'number') {
    where.push('priority = ?')
    params.push(filters.priority)
  }
  if (filters.search) {
    where.push('(name LIKE ? OR domain LIKE ?)')
    params.push(`%${filters.search}%`, `%${filters.search}%`)
  }

  const sql = `
    SELECT ${TARGET_COLUMNS} FROM targets
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY priority ASC, tier DESC, name ASC
    LIMIT ?
  `
  params.push(Math.min(filters.limit ?? 500, 1000))

  return (
    getDb()
      .prepare(sql)
      .all(...params) as Row[]
  ).map(toTarget)
}

export function getTarget(id: string): Target | null {
  const row = getDb().prepare(`SELECT ${TARGET_COLUMNS} FROM targets WHERE id = ?`).get(id) as
    Row | undefined
  return row ? toTarget(row) : null
}

// ---------------------------------------------------------------------------
// Subjects and jobs
// ---------------------------------------------------------------------------

export function ensureSubject(hash: string): void {
  getDb()
    .prepare('INSERT INTO subjects (hash, created_at) VALUES (?, ?) ON CONFLICT (hash) DO NOTHING')
    .run(hash, new Date().toISOString())
}

export function createJob(subjectHash: string, targetId: string, status: JobStatus): Job {
  ensureSubject(subjectHash)
  const now = new Date().toISOString()
  const id = randomUUID()
  getDb()
    .prepare(
      `INSERT INTO jobs (id, subject_hash, target_id, status, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(id, subjectHash, targetId, status, now, now)
  const job = getJob(id)
  if (!job) throw new Error('job insert failed')
  return job
}

function toJob(row: Row): Job {
  return {
    id: String(row['id']),
    subjectHash: String(row['subject_hash']),
    targetId: String(row['target_id']),
    status: row['status'] as JobStatus,
    attempts: Number(row['attempts'] ?? 0),
    lastAttemptAt: (row['last_attempt_at'] as string | null) ?? null,
    nextCheckAt: (row['next_check_at'] as string | null) ?? null,
    failureReason: (row['failure_reason'] as string | null) ?? null,
  }
}

const JOB_COLUMNS = `id, subject_hash, target_id, status, attempts, last_attempt_at, next_check_at, failure_reason`

export function getJob(id: string): Job | null {
  const row = getDb().prepare(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ?`).get(id) as
    Row | undefined
  return row ? toJob(row) : null
}

export function listJobs(options: { subjectHash?: string; status?: string; limit?: number } = {}) {
  const where: string[] = []
  const params: Array<string | number> = []
  if (options.subjectHash) {
    where.push('j.subject_hash = ?')
    params.push(options.subjectHash)
  }
  if (options.status) {
    where.push('j.status = ?')
    params.push(options.status)
  }
  const sql = `
    SELECT j.id, j.subject_hash, j.target_id, j.status, j.attempts, j.last_attempt_at,
           j.next_check_at, j.failure_reason,
           t.name AS target_name, t.domain AS target_domain, t.priority
    FROM jobs j JOIN targets t ON t.id = j.target_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY t.priority ASC, j.updated_at DESC
    LIMIT ?
  `
  params.push(Math.min(options.limit ?? 200, 1000))
  return (
    getDb()
      .prepare(sql)
      .all(...params) as Row[]
  ).map((row) => ({
    ...toJob(row),
    targetName: String(row['target_name']),
    targetDomain: String(row['target_domain']),
    priority: Number(row['priority'] ?? 2),
  }))
}

export interface JobPatch {
  status?: JobStatus
  failureReason?: string | null
  attempts?: number
  nextCheckAt?: string | null
  touchAttempt?: boolean
}

export function updateJob(id: string, patch: JobPatch): Job | null {
  const current = getJob(id)
  if (!current) return null

  const now = new Date().toISOString()
  // A status change counts as an attempt against the 3-strike demotion rule (DESIGN §5.1).
  // Getting this wrong makes the counter silently useless, which is worse than absent.
  const attempts = patch.attempts ?? (patch.touchAttempt ? current.attempts + 1 : current.attempts)

  getDb()
    .prepare(
      `UPDATE jobs SET
         status = ?, failure_reason = ?, attempts = ?, next_check_at = ?,
         last_attempt_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.status ?? current.status,
      patch.failureReason === undefined ? current.failureReason : patch.failureReason,
      attempts,
      patch.nextCheckAt === undefined ? current.nextCheckAt : patch.nextCheckAt,
      patch.touchAttempt ? now : current.lastAttemptAt,
      now,
      id,
    )
  return getJob(id)
}

// ---------------------------------------------------------------------------
// Observations and submissions
// ---------------------------------------------------------------------------

export function addObservation(
  jobId: string,
  result: ObservationResult,
  fields: string[],
  sweepSource?: string,
): Observation {
  const observedAt = new Date().toISOString()
  const info = getDb()
    .prepare(
      `INSERT INTO observations (job_id, observed_at, result, fields, sweep_source)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(jobId, observedAt, result, JSON.stringify(fields), sweepSource ?? null)
  return {
    id: Number(info.lastInsertRowid),
    jobId,
    observedAt,
    result,
    fields,
    ...(sweepSource ? { sweepSource } : {}),
  }
}

export function listObservations(jobId: string): Observation[] {
  return (
    getDb()
      .prepare(
        `SELECT id, job_id, observed_at, result, fields, sweep_source
       FROM observations WHERE job_id = ? ORDER BY observed_at DESC`,
      )
      .all(jobId) as Row[]
  ).map((row) => ({
    id: Number(row['id']),
    jobId: String(row['job_id']),
    observedAt: String(row['observed_at']),
    result: row['result'] as ObservationResult,
    fields: parseJson<string[]>(row['fields']) ?? [],
    ...(row['sweep_source'] ? { sweepSource: String(row['sweep_source']) } : {}),
  }))
}

export function addSubmission(jobId: string, channel: 'form' | 'email', confirmationRef?: string) {
  const id = randomUUID()
  const submittedAt = new Date().toISOString()
  getDb()
    .prepare(
      `INSERT INTO submissions (id, job_id, submitted_at, channel, confirmation_ref)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, jobId, submittedAt, channel, confirmationRef ?? null)
  return { id, jobId, submittedAt, channel, confirmationRef: confirmationRef ?? null }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function countBy(table: string, column: string): Record<string, number> {
  const rows = getDb()
    .prepare(`SELECT ${column} AS key, COUNT(*) AS n FROM ${table} GROUP BY ${column}`)
    .all() as Row[]
  return Object.fromEntries(rows.map((r) => [String(r['key']), Number(r['n'])]))
}

export function getStats(): StatsResponse {
  const targets = listTargets({ limit: 1000 })
  const byStatus = countBy('jobs', 'status')

  const total = (statuses: JobStatus[]): number =>
    statuses.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0)

  return {
    targets: {
      total: targets.length,
      enforceable: targets.filter((t) => t.tier === 'enforceable').length,
      broker: targets.filter((t) => t.tier === 'broker').length,
      byPriority: targets.reduce<Record<string, number>>((acc, t) => {
        acc[String(t.priority)] = (acc[String(t.priority)] ?? 0) + 1
        return acc
      }, {}),
    },
    jobs: {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      byStatus,
    },
    progress: {
      removed: total(['removed']),
      submitted: total(['submitted', 'verifying', 'awaiting-confirm']),
      awaitingHuman: total(['awaiting-challenge', 'assisted-manual', 'id-required']),
      reListed: total(['re-listed']),
      notStarted: total(['pending', 'searching', 'found', 'queued', 'not-found']),
    },
  }
}
