# Implementation plan

Companion to `DESIGN.md`. Read that first; this assumes its decisions.

**Sequencing principle: risk-first tracer bullets.** Every milestone is a *vertical*
slice that produces something observable end-to-end, and the scariest unknown is
attacked in milestone 3 — not month four. Nothing here is sequenced by layer.

---

## Why this order

Three things can kill this project:

1. **The phone-side CAPTCHA handoff** — a live browser session held open across a network
   boundary to a sleeping phone. Novel, unproven, and everything else depends on it.
2. **The PII boundary leaking** — traces, HAR files, and request-body logs silently
   writing name/address/DOB to disk. Boring, and the single most likely real-world harm.
3. **The ledger being useless** — if the inventory is unreadable, the app gets abandoned
   regardless of how many removals succeeded.

Milestones 1–3 exist to find out fast. Everything after is adding rows to a table.

---

## M0 — Walking skeleton (~1–2 days)

**Goal:** a deployable, installable, push-capable app that can talk to the box. No domain
logic whatsoever.

- Monorepo scaffolding, shared types, lint/format, CI.
- SvelteKit PWA shell → Cloudflare Pages. Manifest, service worker, install prompt,
  `navigator.storage.persist()`.
- Orchestrator API on the home box, reachable over Tailscale only. `GET /health`.
- Web Push: VAPID keys, subscription registration, a `dev-nudge` push that wakes the phone
  with the app closed.
- SQLite initialized with an empty schema and a migration runner.

**Done:** phone installs the PWA from the public origin, closes it, receives a push, and
the app shows a message fetched from the box over Tailscale.

**Abort signal:** if push cannot wake the installed app reliably on your actual Android
device, stop and reconsider the whole interaction model. This is cheap to test and
invalidates §5.1.

---

## M1 — Vault and ledger, zero automation (~3–4 days)

**Goal:** the artifact you'd keep using even if the worker never existed.

- Identity tuple editor (name, aliases, addresses, phones, DOB, emails).
- Vault: non-extractable AES-GCM key in IndexedDB, encrypt/decrypt, app-lock on open,
  eviction detection and re-entry flow.
- Vendor BADBOOL, version-pinned, parsed into `Target` rows with auth tier and ☠️ leverage
  ordering preserved. Include a parser test against a checked-in snapshot of the list.
- Ledger UI: grouped by tier and leverage, per-target status, filterable, readable on a
  phone at arm's length.
- Seed the enforceable tier as `Target` rows (6 freezes, optoutprescreen, DMA/ANA, HIBP)
  with deep links — no automation, just rows.

**Done:** the full registry is visible and browsable on the phone; the identity tuple
persists across app restarts and survives a reboot; nothing about the identity reaches
SQLite (assert with a test that dumps every table and greps for the tuple).

**Note:** BADBOOL is a moving target — Radaris and Rehold were dropped from it recently and
OpenDataUSA's registration expired. Do not hardcode assumptions about the list's contents;
parse and diff.

---

## M2 — First observation, read-only (~3–4 days)

**Goal:** prove the worker can see what a broker sees, and that the identity tuple can
reach the worker without being persisted.

- Batch packet: device pushes the decrypted tuple to the worker over Tailscale; stored in
  RAM only.
- Worker: Playwright + stock Chromium, no stealth, no proxy, on the residential IP.
- **One** adapter, read-only: query a broker's search endpoint, return
  `found | not-found` plus the exposed fields. No form submission, no CAPTCHA.
- `Observation` written (result + field names only — **not** field values).
- Ledger shows the observation.
- Playwright configured with tracing and HAR **off**; add a test that asserts no trace/HAR
  files are produced.

**Done:** the first ☠️ broker reports `found` for your real identity, and `grep` over the
box's disk finds no PII after the batch closes.

**Risk being retired:** IP reputation, page markup, and the PII-leak surface. If Cloudflare
blocks the residential IP from request one, everything downstream is moot.

---

## M3 — The handoff, one broker end-to-end (~1–2 weeks) ⚠️ the milestone that matters

**Goal:** a single real removal, from search to confirmed-removed, with a human solving the
challenge on the phone.

Target the known-CAPTCHA case first — FastPeopleSearch is the natural pick (BADBOOL notes
it needs a CAPTCHA) because it exercises the hard path immediately.

- Worker drives the opt-out form to the challenge widget, stops, captures a screenshot of
  the widget region, creates an `awaiting-challenge` job, and pushes the phone.
- PWA handoff screen: challenge view, "I've solved it" resume trigger, cancel.
- Resume → submit → capture response → status `awaiting-confirm`.
- Per-broker timeout (15 min default), degraded to assisted-manual with a deep link.
- Assisted-manual path: pre-filled instructions + deep link, user does it, marks done.
- Failure classification: typed adapter errors (`MARKUP_CHANGED`, `BLOCKED`,
  `CHALLENGE_TIMEOUT`, `AUTH_REQUIRED`); 3 strikes ⇒ permanent demotion to assisted-manual.

**Done:** a real profile disappears from that broker's public search, and the ledger says
`awaiting-confirm` with a receipt attached.

**Abort/pivot criteria — decide honestly at the end of this milestone:**
- If the held-session handoff is unreliable after two honest attempts, pivot to
  **assisted-manual as the primary mechanism** (deep link + prefilled instructions + ledger)
  and keep automation only for brokers with no challenge. That is a smaller product but a
  working one, and it is a legitimate outcome, not a failure.
- If every broker blocks the residential IP, the broker tier collapses to a checklist and
  the enforceable tier becomes the whole product.

**Do not proceed to M4+ until this milestone's outcome is settled.**

---

## M4 — Close the verification loop (~3–4 days)

**Goal:** confirmations complete without human clicks.

- One-time setup doc: Gmail filter for broker/deletion domains → dedicated address.
- Mailbox reader on the box: poll IMAP or inbound webhook, match sender domain → pending
  job, extract confirmation link or reply address, complete it, store receipt in the
  device vault.
- Treat the forwarded inbox as a capability store: dedicated domain, restricted access,
  documented rotation procedure.
- `id-required` detection: recognise "we need a photo ID" responses and route to the user as
  a task rather than retrying.

**Done:** a job submits and reaches `submitted` with no manual click, and a receipt lands in
the vault.

---

## M5 — Enforceable tier wizard (~2–3 days)

**Goal:** the tier with actual teeth, finished.

- Credit-freeze checklist: 6 bureaus, per-bureau instructions, deep links, "frozen /
  thawed / PIN stored" state, and a reminder cadence.
- optoutprescreen.com flow (electronic + the mail-back permanent option).
- DMA/ANA opt-outs.
- HIBP subscription confirmation.
- Frame honestly in the UI: these are federal rights, the others are requests.

**Done:** every enforceable-tier row is actionable from the phone with instructions, and
the app can answer "what's still not done in the tier that actually matters."

---

## M6 — The loop (~4–5 days)

**Goal:** turn a snapshot into a state machine.

- Scheduler on the box: broker search re-checks on a cadence, diffing `Observation`
  snapshots.
- Re-listing detection: previously-removed subject reappears ⇒ `re-listed` ⇒ auto-requeue.
- Verification rule (resolves open question 1): `removed` after N consecutive clean
  observations spaced over M days; pick N=3, M=30, and state the weakness in the UI.
- Brave Search sweep: quarterly or on-demand, quota-aware, results diffed into the ledger.
  **Never** Google or Bing — an IP ban there poisons the removal egress IP.
- Push: only for action-required events (challenge waiting, ID required, re-listed).
  Weekly digest otherwise.
- Headline metric: % of confirmed removals still holding at 30/90/180 days.

**Done:** leave it running for two weeks unattended with no false-positive re-lists and no
missed real ones.

---

## M7 — Breadth (~1–2 weeks, then ongoing)

- Expand to the other four ☠️ targets, then long-tail by leverage.
- Adapter framework: a declarative per-broker spec (search URL template, result selector,
  opt-out flow steps, challenge selector, confirmation matcher) so adding a broker is data,
  not code. Only drop to code when a spec cannot express it.
- Adapter health dashboard: last success/failure per target, so silent rot is visible.
- Refresh BADBOOL: scheduled upstream diff, human review, version bump.

**Done:** 5 ☠️ targets working end-to-end, and a documented, tested path for adding the sixth.

---

## M8 — Hardening (ongoing, ~2–3 days focused)

- Threat-model items from `DESIGN.md` §9: disable core dumps, tmpfs-backed swap, no
  trace/HAR, structured logging with a PII-redaction test.
- Backup/restore story for the vault (encrypted export to user's own storage).
- Vault-eviction re-entry UX.
- Cost review: Brave tier, domain, Tailscale, electricity. Confirm nothing justifies a paid
  proxy or solver — current design says no.

---

## Testing strategy

| Layer | Approach |
|---|---|
| Vault / crypto | Unit tests; property test encrypt→decrypt roundtrip; test that a non-extractable key cannot be exported |
| PII boundary | **Assertion test over the whole SQLite file**: after a full batch, dump every table and byte-grep for name, addresses, phones, DOB, emails. Must be clean. This is the most important test in the repo |
| BADBOOL parser | Fixture snapshot of the list; parse to targets; assert leverage and auth tiers survive |
| Adapters | Recorded HTML fixtures per broker; adapter runs against fixtures in CI, against live sites only manually |
| Handoff | Manual protocol with a checklist per release; no realistic automation available |
| Re-list diffing | Pure-function tests over synthetic observation sequences |
| End-to-end | One ☠️ broker, manual, per release |

Adapters are tested against fixtures, not the live web — a CI job that hits brokers will get
the runner IP banned and produces flaky failures that teach nothing.

---

## Cost estimate

Free or near-free: Cloudflare Pages, Tailscale personal, Brave free tier (~1,000 queries/mo,
and a quarterly sweep of a small tuple needs far less), HIBP, optoutprescreen. Marginal:
domain, electricity for an always-on box. **No paid CAPTCHA solver, no proxies.**

The real cost is the human CAPTCHA labour: roughly one interaction per challenged target per
cycle. Estimate 5 minutes of attention per target per quarter, and design the push
notification so it is answerable one-handed.

---

## What to kill, and when

- **Kill the broker tier** if M3's abort criteria fire and assisted-manual still can't reach
  most targets. Ship the enforceable tier + ledger; it is a real product with federal law
  behind it.
- **Kill the search sweep** if Brave results are dominated by SEO spam and reseller mirrors
  of the same five upstreams. The sweep is the cheapest thing to drop and the least load-bearing.
- **Kill stealth ambitions permanently.** Already decided; do not relitigate at month three
  when a broker starts blocking.

---

## Rough total

~5–7 weeks of focused work to M7, with M3 being the swing factor and realistically the
milestone that takes twice its estimate. M0–M1 (~1 week) deliver something already useful
even if everything after M2 is abandoned.
