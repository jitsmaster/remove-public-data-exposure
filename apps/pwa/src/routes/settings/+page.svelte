<script lang="ts">
  import { onMount } from 'svelte'
  import { loadServer, saveServer, clearServer, api } from '$lib/connection'

  let url = $state('')
  let token = $state('')
  let status = $state<string | null>(null)
  let testing = $state(false)

  onMount(() => {
    const existing = loadServer()
    if (existing) {
      url = existing.url
      token = existing.token
    }
  })

  function save() {
    saveServer({ url, token })
    status = 'Saved.'
  }

  function forget() {
    clearServer()
    url = ''
    token = ''
    status = 'Cleared.'
  }

  async function test() {
    saveServer({ url, token })
    testing = true
    status = null
    try {
      const health = await api<{ version: string; pushConfigured: boolean }>('/health')
      status = `Reachable. v${health.version}, push ${health.pushConfigured ? 'on' : 'off'}.`
    } catch (error) {
      status = error instanceof Error ? error.message : String(error)
    } finally {
      testing = false
    }
  }
</script>

<section class="card">
  <h2>Orchestrator address</h2>
  <p class="muted">
    The home box is never exposed to the internet. This address is only reachable while Tailscale is
    up on this phone.
  </p>
  <div style="margin-top: 0.75rem">
    <label for="url">Base URL (tailnet)</label>
    <input
      id="url"
      bind:value={url}
      placeholder="http://homebox.tail1234.ts.net:8787"
      autocomplete="off"
      spellcheck="false"
    />
  </div>
  <div style="margin-top: 0.75rem">
    <label for="token">API token (optional, if API_TOKEN is set on the server)</label>
    <input id="token" bind:value={token} type="password" autocomplete="off" spellcheck="false" />
  </div>
  <div class="row" style="margin-top: 1rem">
    <button onclick={save}>Save</button>
    <button class="secondary" onclick={test} disabled={testing || !url}>
      {testing ? 'Testing…' : 'Save &amp; test'}
    </button>
  </div>
  <div class="row">
    <button class="secondary" onclick={forget}>Forget</button>
  </div>
  {#if status}<p class="muted">{status}</p>{/if}
</section>

<section class="card">
  <h2>This app is public, you are not</h2>
  <p class="muted">
    The PWA shell is served from a public static origin and contains no data. Everything about you
    lives in IndexedDB on this device, encrypted with a non-extractable key.
  </p>
</section>
