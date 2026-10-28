import { api } from './connection'

/**
 * Web Push is the only reliable way to wake this app on Android — background sync is gone,
 * and the CAPTCHA handoff in DESIGN.md §5.1 depends on getting the notification promptly.
 */

function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const buffer = new ArrayBuffer(raw.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export async function enablePush(label: string): Promise<void> {
  if (!pushSupported()) throw new Error('Push is not supported in this browser.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error(`Notification permission ${permission}.`)

  const registration = await navigator.serviceWorker.ready
  const { publicKey } = await api<{ publicKey: string }>('/push/vapid-public-key')

  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }))

  const json = subscription.toJSON() as { endpoint?: string; keys?: Record<string, string> }
  const { endpoint, keys } = json
  if (!endpoint || !keys?.['p256dh'] || !keys['auth']) {
    throw new Error('Subscription is missing its endpoint or keys.')
  }

  await api('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      subscription: { endpoint, keys: { p256dh: keys['p256dh'], auth: keys['auth'] } },
      label,
    }),
  })
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return
  await api('/push/subscribe', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => undefined)
  await subscription.unsubscribe()
}

export async function currentPushEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  return subscription?.endpoint ?? null
}

/**
 * Ask Chrome not to evict our storage. The entire vault lives in IndexedDB, so eviction
 * would mean re-entering the identity tuple. This *requests* persistence; it does not
 * guarantee it. See DESIGN.md §9.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}
