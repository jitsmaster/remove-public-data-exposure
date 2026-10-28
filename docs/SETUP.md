# Setup — M0

Goal of M0: **the phone installs the app from a public origin, closes it, and receives a push that
it fetches from the home box over Tailscale.** Nothing else. If this doesn't work on your actual
Android device, stop — M3 depends on it entirely.

## 0. Prerequisites

- Node 24+ (uses `node:sqlite`, no native build step)
- pnpm 10
- An always-on machine at home (the "box"), on a residential IP
- Tailscale installed on the box **and** on the Android phone
- A Cloudflare account (or GitHub Pages) for the static shell

```bash
pnpm install
pnpm icons        # generates the PNG icons (no dependencies)
```

## 1. The box

```bash
cd apps/server
cp .env.example .env
pnpm vapid        # prints a public/private key pair — paste into .env
```

Set in `.env`:

- `VAPID_SUBJECT` — a `mailto:` you control. Keep it generic; it is shipped to Google's push
  service.
- `API_TOKEN` — generate one (`openssl rand -hex 32`). Optional, but it is the only thing between
  anything else on your tailnet and this API.
- `PWA_ORIGIN` — the Pages origin, e.g. `https://rpde.pages.dev`, plus `http://localhost:5173` for
  dev. Comma-separated.

```bash
pnpm dev          # http://127.0.0.1:8787
```

Verify: `curl -s localhost:8787/health`

**Reach it from the phone's browser over Tailscale before going further.** Use the box's tailnet
name (`http://<host>.<tailnet>.ts.net:8787`) or its `100.x` address. If that fails, everything
after this fails.

Bind consideration: the dev server listens on all interfaces. On the box, that means the tailnet
too — which is what you want, and is still unreachable from the public internet.

## 2. The shell

```bash
pnpm dev:pwa     # http://localhost:5173
```

To install on the phone you need HTTPS, so deploy the shell:

```bash
pnpm --filter @rpde/pwa build      # outputs apps/pwa/build
```

Deploy `apps/pwa/build` to Cloudflare Pages (direct upload or git integration). The shell contains
**no data** — it is UI only, and can be public.

Open the Pages URL in Chrome on the phone → menu → **Add to Home screen**.

## 3. Wire the phone up

1. Launch the installed app.
2. **Settings** → enter the tailnet URL and the API token → _Save & test_ → expect
   `Reachable. v0.0.0, push on.`
3. Back on **Status** → _Enable push_ → accept the permission prompt.
4. Confirm the row reads `subscribed`.
5. **Close the app completely** (swipe it away), then press _Send test push_ from a second
   device or `curl`:

```bash
curl -s -X POST localhost:8787/push/dev-nudge \
  -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' -d '{}'
```

**M0 is done when the notification arrives with the app closed.** Then tap it — it should reopen
the app.

## 4. Things that will bite

| Symptom                                    | Cause                                                                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| _No server configured_                     | Settings not saved, or localStorage cleared                                                                                                        |
| _Cannot reach the server over Tailscale_   | Tailscale off on the phone; box asleep; URL wrong port                                                                                             |
| Push never arrives, app closed             | VAPID keys missing (check `/health` → `pushConfigured`), or Chrome battery optimisation killed the subscription — exempt the app from optimisation |
| Push works but tapping does nothing        | `notificationclick` in `src/service-worker.ts`; check `chrome://inspect`                                                                           |
| Notification permission denied permanently | Chrome site settings — must be reset in Android settings                                                                                           |
| "Storage is not persistent" banner         | Chrome declined; usually install + engagement fixes it. The vault is at risk either way                                                            |
| `ExperimentalWarning: SQLite`              | Expected. `node:sqlite` is stable enough for this; it removes a native dependency                                                                  |

## 5. What is deliberately missing

No vault, no ledger, no registry, no Playwright, no worker. Those are M1 and M2. The `/health`
endpoint is the only place the phone and box talk, and it is meant to stay that way until M2 needs
a batch packet.
