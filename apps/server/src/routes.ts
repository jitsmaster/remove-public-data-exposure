import { Hono } from 'hono'
import type {
  ApiError,
  CreateJobRequest,
  JobListResponse,
  JobStatus,
  RecordObservationRequest,
  RecordSubmissionRequest,
  StatsResponse,
  TargetListResponse,
  UpdateJobRequest,
} from '@rpde/shared'
import { JOB_STATUSES } from '@rpde/shared'
import {
  addObservation,
  addSubmission,
  createJob,
  getJob,
  getStats,
  getTarget,
  listJobs,
  listObservations,
  listTargets,
  updateJob,
} from './repo.ts'
import type { TargetFilters } from './repo.ts'

export const routes = new Hono()

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

routes.get('/targets', (c) => {
  const filters: TargetFilters = {}
  const tier = c.req.query('tier')
  const leverage = c.req.query('leverage')
  const authTier = c.req.query('authTier')
  const search = c.req.query('search')
  const priority = c.req.query('priority')
  const limit = c.req.query('limit')

  if (tier) filters.tier = tier
  if (leverage) filters.leverage = leverage
  if (authTier) filters.authTier = authTier
  if (search) filters.search = search
  if (priority) filters.priority = Number(priority)
  if (limit) filters.limit = Number(limit)

  const targets = listTargets(filters)
  return c.json<TargetListResponse>({ targets, total: targets.length })
})

routes.get('/targets/:id', (c) => {
  const target = getTarget(c.req.param('id'))
  if (!target) return c.json<ApiError>({ error: 'target not found' }, 404)
  return c.json(target)
})

routes.get('/stats', (c) => c.json<StatsResponse>(getStats()))

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

routes.post('/jobs', async (c) => {
  const body = await c.req.json<CreateJobRequest>().catch(() => null)
  if (!body?.subjectHash || !body.targetId) {
    return c.json<ApiError>({ error: 'subjectHash and targetId are required' }, 400)
  }
  if (!getTarget(body.targetId)) {
    return c.json<ApiError>({ error: `unknown targetId: ${body.targetId}` }, 400)
  }
  const status = (body.status ?? 'pending') as JobStatus
  if (!JOB_STATUSES.includes(status)) {
    return c.json<ApiError>({ error: `invalid status: ${status}` }, 400)
  }
  return c.json(createJob(body.subjectHash, body.targetId, status), 201)
})

routes.get('/jobs', (c) => {
  const options: { subjectHash?: string; status?: string; limit?: number } = {}
  const subjectHash = c.req.query('subjectHash')
  const status = c.req.query('status')
  const limit = c.req.query('limit')

  if (subjectHash) options.subjectHash = subjectHash
  if (status) options.status = status
  if (limit) options.limit = Number(limit)

  const jobs = listJobs(options)
  return c.json<JobListResponse>({ jobs, total: jobs.length })
})

routes.get('/jobs/:id', (c) => {
  const job = getJob(c.req.param('id'))
  if (!job) return c.json<ApiError>({ error: 'job not found' }, 404)
  return c.json(job)
})

routes.patch('/jobs/:id', async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json<UpdateJobRequest>().catch(() => null)) ?? {}

  if (body.status && !JOB_STATUSES.includes(body.status)) {
    return c.json<ApiError>({ error: `invalid status: ${body.status}` }, 400)
  }

  const patch = {
    ...(body.status ? { status: body.status } : {}),
    ...(body.failureReason !== undefined ? { failureReason: body.failureReason } : {}),
    ...(typeof body.attempts === 'number' ? { attempts: body.attempts } : {}),
    ...(body.nextCheckAt !== undefined ? { nextCheckAt: body.nextCheckAt } : {}),
    // Any explicit status change from a worker counts as an attempt against the 3-strike
    // demotion rule in DESIGN.md §5.1.
    ...(body.status ? { touchAttempt: true } : {}),
  }

  const job = updateJob(id, patch)
  if (!job) return c.json<ApiError>({ error: 'job not found' }, 404)
  return c.json(job)
})

routes.post('/jobs/:id/observations', async (c) => {
  const jobId = c.req.param('id')
  if (!getJob(jobId)) return c.json<ApiError>({ error: 'job not found' }, 404)

  const body = await c.req.json<RecordObservationRequest>().catch(() => null)
  if (!body || (body.result !== 'found' && body.result !== 'not-found')) {
    return c.json<ApiError>({ error: "result must be 'found' or 'not-found'" }, 400)
  }
  // Field *names* only. If a worker ever posts a value here it is a bug in the worker, and
  // the ledger is where it would become permanent.
  const fields = Array.isArray(body.fields) ? body.fields.slice(0, 40).map(String) : []
  return c.json(addObservation(jobId, body.result, fields, body.sweepSource), 201)
})

routes.get('/jobs/:id/observations', (c) => {
  const jobId = c.req.param('id')
  if (!getJob(jobId)) return c.json<ApiError>({ error: 'job not found' }, 404)
  return c.json({ observations: listObservations(jobId) })
})

routes.post('/jobs/:id/submissions', async (c) => {
  const jobId = c.req.param('id')
  if (!getJob(jobId)) return c.json<ApiError>({ error: 'job not found' }, 404)

  const body = await c.req.json<RecordSubmissionRequest>().catch(() => null)
  if (!body || (body.channel !== 'form' && body.channel !== 'email')) {
    return c.json<ApiError>({ error: "channel must be 'form' or 'email'" }, 400)
  }
  return c.json(addSubmission(jobId, body.channel, body.confirmationRef), 201)
})
