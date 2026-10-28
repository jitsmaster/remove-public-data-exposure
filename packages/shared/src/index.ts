/**
 * Types shared between the PWA (device) and the orchestrator/worker (home box).
 *
 * The single most important rule in this codebase lives here: **no PII crosses this
 * boundary into anything persisted.** `Identity` is the only PII-bearing type, and it is
 * deliberately excluded from every request/response type that the server writes down.
 * See DESIGN.md §5.2.
 */

// ---------------------------------------------------------------------------
// Identity — device-only. Never imported by server code.
// ---------------------------------------------------------------------------

export interface Identity {
  fullName: string
  aliases: string[]
  addresses: Address[]
  phones: string[]
  /** ISO date, YYYY-MM-DD. Sensitive; device vault only. */
  dob: string
  emails: string[]
}

export interface Address {
  line1: string
  line2?: string
  city: string
  region: string
  postalCode: string
  /** Free-form: 'current' | 'prior-2019' | ... */
  label: string
}

/**
 * The batch packet: the one shape in which PII is allowed onto the home box.
 * Held in RAM only for the duration of a batch. See DESIGN.md §5.2.
 */
export interface BatchPacket {
  subjectHash: string
  identity: Identity
  /** Identifies the batch; used to drop the packet when the batch closes. */
  batchId: string
}

// ---------------------------------------------------------------------------
// Targets and jobs — metadata only, safe to persist
// ---------------------------------------------------------------------------

export type Tier = 'enforceable' | 'broker'
export type Leverage = 'high' | 'normal'
export type AuthTier = 'email' | 'form' | 'captcha' | 'id-required'

export interface Target {
  id: string
  name: string
  domain: string
  tier: Tier
  leverage: Leverage
  authTier: AuthTier
  /** 0 = crucial / statutorily enforceable, 1 = high priority, 2 = tail. */
  priority: number
  section: string | null
  optOutUrl: string
  source: 'badbool' | 'enforceable'
  sourceCommit: string | null
  legalBasis: string | null
  automation: string | null
  steps: string[] | null
  flags: Record<string, boolean> | null
  links: Array<{ text: string; url: string }> | null
  adapter?: string
  badboolVersion?: string
  notes?: string
}

export type JobStatus =
  | 'pending'
  | 'searching'
  | 'found'
  | 'not-found'
  | 'queued'
  | 'awaiting-challenge'
  | 'submitting'
  | 'awaiting-confirm'
  | 'submitted'
  | 'verifying'
  | 'removed'
  | 're-listed'
  | 'ignored'
  | 'assisted-manual'
  | 'id-required'
  | 'failed'

export const JOB_STATUSES: readonly JobStatus[] = [
  'pending',
  'searching',
  'found',
  'not-found',
  'queued',
  'awaiting-challenge',
  'submitting',
  'awaiting-confirm',
  'submitted',
  'verifying',
  'removed',
  're-listed',
  'ignored',
  'assisted-manual',
  'id-required',
  'failed',
] as const

export interface Job {
  id: string
  subjectHash: string
  targetId: string
  status: JobStatus
  attempts: number
  lastAttemptAt: string | null
  nextCheckAt: string | null
  failureReason: string | null
}

export type ObservationResult = 'found' | 'not-found'

/**
 * Note: field *names* are recorded, never field *values*. Knowing that a broker exposes
 * "phone" is useful; knowing the phone number is a liability.
 */
export interface Observation {
  id: number
  jobId: string
  observedAt: string
  result: ObservationResult
  fields: string[]
  sweepSource?: string
}

export type AdapterErrorCode =
  'MARKUP_CHANGED' | 'BLOCKED' | 'CHALLENGE_TIMEOUT' | 'AUTH_REQUIRED' | 'NETWORK' | 'UNKNOWN'

export const ADAPTER_ERROR_CODES: readonly AdapterErrorCode[] = [
  'MARKUP_CHANGED',
  'BLOCKED',
  'CHALLENGE_TIMEOUT',
  'AUTH_REQUIRED',
  'NETWORK',
  'UNKNOWN',
] as const

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface HealthResponse {
  ok: true
  service: 'rpde-orchestrator'
  version: string
  now: string
  /** false when no VAPID keys are configured; push is unavailable. */
  pushConfigured: boolean
}

export interface PushSubscriptionPayload {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface RegisterSubscriptionRequest {
  subscription: PushSubscriptionPayload
  /** Free-form device label so a second phone can be identified and revoked. */
  label: string
}

export interface DevNudgeRequest {
  /** Optional subset of subscription endpoints; omit to notify all. */
  endpoints?: string[]
  title?: string
  body?: string
}

export interface ApiError {
  error: string
  detail?: string
}

// ---------------------------------------------------------------------------
// API payloads
// ---------------------------------------------------------------------------

export interface TargetListResponse {
  targets: Target[]
  total: number
}

export interface JobListResponse {
  jobs: Array<Job & { targetName: string; targetDomain: string; priority: number }>
  total: number
}

export interface CreateJobRequest {
  subjectHash: string
  targetId: string
  status?: JobStatus
}

export interface UpdateJobRequest {
  status?: JobStatus
  failureReason?: string | null
  attempts?: number
  nextCheckAt?: string | null
}

export interface RecordObservationRequest {
  result: ObservationResult
  fields?: string[]
  sweepSource?: string
}

export interface RecordSubmissionRequest {
  channel: 'form' | 'email'
  confirmationRef?: string
}

/** Where the subject's exposure stands. The only number worth putting on a home screen. */
export interface StatsResponse {
  targets: {
    total: number
    enforceable: number
    broker: number
    byPriority: Record<string, number>
  }
  jobs: { total: number; byStatus: Record<string, number> }
  /** Confirmed removed, versus everything discovered. Deliberately unflattering. */
  progress: {
    removed: number
    submitted: number
    awaitingHuman: number
    reListed: number
    notStarted: number
  }
}
