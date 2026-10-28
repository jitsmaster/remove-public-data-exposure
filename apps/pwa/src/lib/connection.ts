/**
 * Connection to the orchestrator on the home box, over Tailscale.
 *
 * The URL and token live in localStorage on the device only. They are not secrets worth
 * encrypting individually (the vault key is), but they are capabilities: without the
 * Tailscale route they are useless from anywhere else.
 */

export interface ServerConfig {
  /** e.g. http://homebox.tailnet-name.ts.net:8787 or an IP:port on the tailnet */
  url: string
  token: string
}

const KEY = 'rpde.server'

export function loadServer(): ServerConfig | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ServerConfig>
    if (!parsed.url) return null
    return { url: parsed.url.replace(/\/+$/, ''), token: parsed.token ?? '' }
  } catch {
    return null
  }
}

export function saveServer(config: ServerConfig): void {
  localStorage.setItem(
    KEY,
    JSON.stringify({ url: config.url.trim().replace(/\/+$/, ''), token: config.token.trim() }),
  )
}

export function clearServer(): void {
  localStorage.removeItem(KEY)
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = loadServer()
  if (!config) throw new ApiError('No server configured. Open Settings.', 0)

  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (config.token) headers.set('Authorization', `Bearer ${config.token}`)

  let response: Response
  try {
    response = await fetch(`${config.url}${path}`, { ...init, headers })
  } catch (error) {
    // Almost always: Tailscale is off on the phone, or the box is asleep.
    throw new ApiError(
      `Cannot reach the server over Tailscale (${error instanceof Error ? error.message : 'network error'})`,
      0,
    )
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new ApiError(`${response.status} ${detail || response.statusText}`, response.status)
  }
  return (await response.json()) as T
}
