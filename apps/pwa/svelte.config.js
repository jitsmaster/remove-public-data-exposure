import adapter from '@sveltejs/adapter-static'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Static shell only. No server-side rendering concerns, no data ever rendered
    // server-side, and it deploys to Cloudflare Pages as files.
    adapter: adapter({ fallback: 'index.html' }),
  },
}

export default config
