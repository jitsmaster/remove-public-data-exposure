/// <reference types="@sveltejs/kit" />

/**
 * SvelteKit owns this file and wraps it with its own caching logic; keep it to push
 * handling only. Payloads are JSON: { title, body, url?, tag? }.
 */

interface Payload {
  title: string
  body: string
  url?: string
  tag?: string
}

interface PushEventLike {
  data: { json(): unknown } | null
  waitUntil(promise: Promise<unknown>): void
}

interface NotificationClickEventLike {
  notification: { close(): void; data?: unknown }
  waitUntil(promise: Promise<unknown>): void
}

const scope = self as unknown as {
  addEventListener(type: 'push', listener: (event: PushEventLike) => void): void
  addEventListener(
    type: 'notificationclick',
    listener: (event: NotificationClickEventLike) => void,
  ): void
  registration: ServiceWorkerRegistration
  clients: {
    matchAll(options: { type: string; includeUncontrolled: boolean }): Promise<Client[]>
    openWindow(url: string): Promise<Client | null>
  }
}

scope.addEventListener('push', (event) => {
  let payload: Payload = { title: 'rpde', body: 'Something needs attention.' }
  try {
    if (event.data) {
      const parsed = event.data.json() as Partial<Payload>
      payload = {
        title: parsed.title ?? payload.title,
        body: parsed.body ?? payload.body,
        ...(parsed.url ? { url: parsed.url } : {}),
        ...(parsed.tag ? { tag: parsed.tag } : {}),
      }
    }
  } catch {
    // Malformed payload: still show something, never fail silently.
  }

  event.waitUntil(
    scope.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      data: { url: payload.url ?? '/' },
      // No icon: a missing icon renders better than a broken one.
      requireInteraction: true,
    }),
  )
})

scope.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data as { url?: string } | undefined)?.url ?? '/'

  event.waitUntil(
    (async () => {
      const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = windows.find((client) => new URL(client.url).pathname === target)
      if (existing) return existing.focus()
      return scope.clients.openWindow(target)
    })(),
  )
})
