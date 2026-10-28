import webpush from 'web-push'
import type { PushSubscriptionPayload } from '@rpde/shared'
import { env } from './env.ts'
import { getDb } from './db.ts'

let configured = false

export function configurePush(): boolean {
  if (!env.vapid.configured) {
    console.warn('[push] VAPID keys missing; push disabled. Run: pnpm vapid')
    return false
  }
  webpush.setVapidDetails(env.vapid.subject, env.vapid.publicKey, env.vapid.privateKey)
  configured = true
  return true
}

export interface StoredSubscription {
  endpoint: string
  p256dh: string
  auth: string
  label: string
}

export function saveSubscription(sub: PushSubscriptionPayload, label: string): void {
  getDb()
    .prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, label, created_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT (endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         label = excluded.label,
         revoked_at = NULL`,
    )
    .run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, label, new Date().toISOString())
}

export function revokeSubscription(endpoint: string): void {
  getDb()
    .prepare('UPDATE push_subscriptions SET revoked_at = ? WHERE endpoint = ?')
    .run(new Date().toISOString(), endpoint)
}

export function listSubscriptions(): StoredSubscription[] {
  return getDb()
    .prepare(
      `SELECT endpoint, p256dh, auth, label
       FROM push_subscriptions WHERE revoked_at IS NULL`,
    )
    .all() as unknown as StoredSubscription[]
}

export interface PushResult {
  sent: number
  gone: string[]
  failed: Array<{ endpoint: string; error: string }>
}

export async function sendPush(
  payload: { title: string; body: string; url?: string; tag?: string },
  endpoints?: string[],
): Promise<PushResult> {
  if (!configured) throw new Error('push is not configured')

  const wanted = endpoints ? new Set(endpoints) : undefined
  const targets = listSubscriptions().filter((s) => !wanted || wanted.has(s.endpoint))
  const result: PushResult = { sent: 0, gone: [], failed: [] }

  await Promise.all(
    targets.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        )
        result.sent += 1
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          // Subscription is dead; stop retrying it forever.
          revokeSubscription(sub.endpoint)
          result.gone.push(sub.endpoint)
        } else {
          result.failed.push({
            endpoint: sub.endpoint,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }),
  )

  return result
}
