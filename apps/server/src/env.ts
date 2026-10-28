import { existsSync } from 'node:fs'

// Node >=20.12 has process.loadEnvFile; use it so `pnpm dev` picks up .env without flags.
if (existsSync('.env')) {
  process.loadEnvFile('.env')
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var ${name} (see .env.example)`)
  return value
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  dataDir: process.env.DATA_DIR ?? './data',
  pwaOrigins: (process.env.PWA_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  apiToken: process.env.API_TOKEN ?? '',
  vapid: {
    get configured(): boolean {
      return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
    },
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    subject: process.env.VAPID_SUBJECT ?? '',
  },
} as const

export { required }
