import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import type {
  ApiError,
  HealthResponse,
  RegisterSubscriptionRequest,
  DevNudgeRequest,
} from '@rpde/shared'
import { env } from './env.ts'
import { getDb, closeDb } from './db.ts'
import {
  configurePush,
  saveSubscription,
  revokeSubscription,
  listSubscriptions,
  sendPush,
} from './push.ts'

const VERSION = '0.0.0'
const pushReady = configurePush()

const app = new Hono()

app.use(
  '*',
  cors({
    origin: (origin) => (env.pwaOrigins.includes(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }),
)

// Shared-secret gate. Tailscale keeps this service off the public internet; the token is
// defence in depth for anything else on the tailnet.
app.use('*', async (c, next) => {
  if (!env.apiToken) return next()
  if (c.req.method === 'OPTIONS') return next()
  const header = c.req.header('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (token !== env.apiToken) {
    return c.json<ApiError>({ error: 'unauthorized' }, 401)
  }
  return next()
})

app.get('/health', (c) => {
  getDb()
  return c.json<HealthResponse>({
    ok: true,
    service: 'rpde-orchestrator',
    version: VERSION,
    now: new Date().toISOString(),
    pushConfigured: pushReady,
  })
})

app.get('/push/vapid-public-key', (c) => {
  if (!pushReady) return c.json<ApiError>({ error: 'push not configured' }, 503)
  return c.json({ publicKey: env.vapid.publicKey })
})

app.post('/push/subscribe', async (c) => {
  const body = await c.req.json<RegisterSubscriptionRequest>()
  if (!body?.subscription?.endpoint || !body.subscription.keys?.p256dh) {
    return c.json<ApiError>({ error: 'invalid subscription' }, 400)
  }
  saveSubscription(body.subscription, body.label || 'unnamed-device')
  return c.json({ ok: true })
})

app.delete('/push/subscribe', async (c) => {
  const body = await c.req.json<{ endpoint?: string }>()
  if (!body?.endpoint) return c.json<ApiError>({ error: 'endpoint required' }, 400)
  revokeSubscription(body.endpoint)
  return c.json({ ok: true })
})

app.get('/push/subscriptions', (c) =>
  c.json({
    subscriptions: listSubscriptions().map(({ endpoint, label }) => ({ endpoint, label })),
  }),
)

app.post('/push/dev-nudge', async (c) => {
  if (!pushReady) return c.json<ApiError>({ error: 'push not configured' }, 503)
  const body = (await c.req.json<DevNudgeRequest>().catch(() => ({}))) as DevNudgeRequest
  const result = await sendPush(
    {
      title: body.title ?? 'rpde: dev nudge',
      body: body.body ?? 'M0 push plumbing works.',
      url: '/',
      tag: 'dev-nudge',
    },
    body.endpoints,
  )
  return c.json(result)
})

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`[rpde] orchestrator listening on http://127.0.0.1:${info.port}`)
  console.log(`[rpde] data dir: ${env.dataDir}`)
  console.log(`[rpde] allowed origins: ${env.pwaOrigins.join(', ') || '(none)'}`)
  console.log(`[rpde] api token: ${env.apiToken ? 'required' : 'NOT SET'}`)
  console.log(`[rpde] push: ${pushReady ? 'enabled' : 'disabled'}`)
  getDb()
  console.log('[rpde] sqlite ready')
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`\n[rpde] ${signal} — shutting down`)
    server.close()
    closeDb()
    process.exit(0)
  })
}
