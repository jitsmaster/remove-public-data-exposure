<script lang="ts">
  import { onMount } from 'svelte'
  import type { HealthResponse } from '@rpde/shared'
  import { api, loadServer, ApiError } from '$lib/connection'
  import {
    enablePush,
    disablePush,
    currentPushEndpoint,
    pushSupported,
    requestPersistentStorage,
  } from '$lib/push'

  let configured = $state(false)
  let health = $state<HealthResponse | null>(null)
  let healthError = $state<string | null>(null)
  let checking = $state(false)

  let pushEndpoint = $state<string | null>(null)
  let pushBusy = $state(false)
  let pushMessage = $state<string | null>(null)
  let nudgeResult = $state<string | null>(null)

  let persisted = $state<boolean | null>(null)

  async function checkHealth() {
    checking = true
    healthError = null
    try {
      health = await api<HealthResponse>('/health')
    } catch (error) {
      health = null
      healthError = error instanceof ApiError ? error.message : String(error)
    } finally {
      checking = false
    }
  }

  onMount(async () => {
    configured = loadServer() !== null
    persisted = await requestPersistentStorage()
    if (configured) {
      await checkHealth()
      pushEndpoint = await currentPushEndpoint().catch(() => null)
    }
  })

  async function togglePush() {
    pushBusy = true
    pushMessage = null
    try {
      if (pushEndpoint) {
        await disablePush()
        pushEndpoint = null
        pushMessage = 'Push disabled.'
      } else {
        await enablePush('android')
        pushEndpoint = await currentPushEndpoint()
        pushMessage = 'Push enabled.'
      }
    } catch (error) {
      pushMessage = error instanceof Error ? error.message : String(error)
    } finally {
      pushBusy = false
    }
  }

  async function sendNudge() {
    nudgeResult = 'sending…'
    try {
      const result = await api<{ sent: number; gone: string[] }>('/push/dev-nudge', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      nudgeResult = `sent ${result.sent}${result.gone.length ? `, revoked ${result.gone.length}` : ''}`
    } catch (error) {
      nudgeResult = error instanceof Error ? error.message : String(error)
    }
  }
</script>

<section class="card">
  <h2>Orchestrator</h2>
  {#if !configured}
    <p class="warn">No server configured.</p>
    <p class="muted">
      Set the Tailscale address of the home box in <a href="/settings">Settings</a>.
    </p>
  {:else}
    <div class="row">
      <span>Connection</span>
      {#if checking}
        <span class="muted">checking…</span>
      {:else if health}
        <span class="ok">ok · v{health.version}</span>
      {:else}
        <span class="bad">{healthError ?? 'unreachable'}</span>
      {/if}
    </div>
    <div class="row">
      <span>Push (server side)</span>
      <span class:ok={health?.pushConfigured} class:bad={health && !health.pushConfigured}>
        {health ? (health.pushConfigured ? 'configured' : 'missing VAPID keys') : '—'}
      </span>
    </div>
    <div class="row">
      <span>Persistent storage</span>
      <span class:ok={persisted === true} class:warn={persisted === false}>
        {persisted === null ? '—' : persisted ? 'granted' : 'not granted'}
      </span>
    </div>
    <div class="row">
      <button class="secondary" onclick={checkHealth} disabled={checking}>Re-check</button>
    </div>
  {/if}
</section>

<section class="card">
  <h2>Notifications</h2>
  {#if !pushSupported()}
    <p class="bad">Push is not supported here. Install the app first.</p>
  {:else}
    <div class="row">
      <span>This device</span>
      <span class="muted">{pushEndpoint ? 'subscribed' : 'not subscribed'}</span>
    </div>
    <div class="row">
      <button onclick={togglePush} disabled={pushBusy || !configured}>
        {pushEndpoint ? 'Disable push' : 'Enable push'}
      </button>
      <button class="secondary" onclick={sendNudge} disabled={!pushEndpoint}>Send test push</button>
    </div>
    {#if pushMessage}<p class="muted">{pushMessage}</p>{/if}
    {#if nudgeResult}<p class="muted mono">{nudgeResult}</p>{/if}
    <p class="muted">
      Keep the app closed when you press “Send test push”. If nothing arrives, the M0 milestone is
      not done — everything in M3 depends on this working.
    </p>
  {/if}
</section>

<section class="card">
  <h2>M0 checklist</h2>
  <div class="row">
    <span>Installable PWA from public origin</span><span class="muted">this page</span>
  </div>
  <div class="row">
    <span>Orchestrator reachable over Tailscale</span><span class="muted">§1</span>
  </div>
  <div class="row">
    <span>SQLite + migrations on the box</span><span class="muted">see server logs</span>
  </div>
  <div class="row"><span>Web Push wakes the closed app</span><span class="muted">§2</span></div>
</section>

<section class="card">
  <h2>Next</h2>
  <p class="muted">
    M1 builds the vault and the ledger. Until then there is deliberately nothing to browse: the
    registry ships with M1, not before.
  </p>
</section>
