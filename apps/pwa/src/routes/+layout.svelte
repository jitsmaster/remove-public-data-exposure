<script lang="ts">
  import { onMount } from 'svelte'
  import { requestPersistentStorage } from '$lib/push'
  import '../app.css'

  let { children } = $props()
  let storagePersisted = $state<boolean | null>(null)

  onMount(async () => {
    // The vault lives in IndexedDB; ask Chrome not to evict it.
    storagePersisted = await requestPersistentStorage()
  })
</script>

<div class="app">
  <header>
    <a class="brand" href="/">rpde</a>
    <nav>
      <a href="/">Status</a>
      <a href="/settings">Settings</a>
    </nav>
  </header>

  <main>
    {@render children()}
  </main>

  <footer>
    {#if storagePersisted === false}
      <p class="warn">
        Storage is not persistent. Chrome may evict the vault; you would have to re-enter your
        identity tuple.
      </p>
    {/if}
    <p class="muted">No personal data is stored on any server. See DESIGN.md §5.2.</p>
  </footer>
</div>
