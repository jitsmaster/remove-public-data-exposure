# remove-public-data-exposure

An Android-only PWA plus a residential-IP worker that inventories and reduces personal-data
exposure for one person's identity — name, addresses, phones, DOB, and two email addresses.

Two tiers, separated by **legal strength**, not difficulty:

| Tier            | What                                                                                                         | Legal basis                               |
| --------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| **Enforceable** | Credit freezes ×6, prescreened-offer opt-out, DMA/ANA lists, breach notifications                            | US federal law (FCRA)                     |
| **Voluntary**   | 51 broker opt-outs (11 💐 crucial, 5 ☠ high) + 11 enforceable rows = **60 targets**; verified and re-checked | None in Washington — these are _requests_ |

The ledger covers both. Only one tier has teeth, and the app says so.

## Read these

- **[`DESIGN.md`](./DESIGN.md)** — constraints that shaped the architecture, the two-tier
  model, the three risky seams (CAPTCHA handoff, PII boundary, verification loop), data
  model, failure modes, threat model.
- **[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md)** — risk-first milestone sequence
  with explicit pivot criteria.

## What this is not

- Not a scraper that finds "everyone who has your email." That set is not observable.
- Not a spam-volume measurement tool.
- Not CAPTCHA circumvention — a human solves every challenge, no stealth, no proxies.
- Not a California-grade erasure service. Washington has no comprehensive privacy law.

## ⚠️ This repo is public and must stay PII-free

No identity data, no `.env`, no Playwright traces, no HAR files, no screenshots, no vault
exports — ever. `.gitignore` blocks the obvious vectors; a committed trace file is a
permanent leak in git history that no opt-out form can undo.

Contributions that include real personal data will be rewritten out of history.

## Status

Design complete. **M0** (installable PWA + orchestrator + Web Push) and the **M1 API**
(registry, jobs, observations, submissions, stats) are in place. Nothing yet talks to a
broker site — that is M2/M3.

## API

Orchestrator listens on `:8787`. Job metadata only — no endpoint accepts personal data.

| Method  | Path                                                                                  | Purpose                                                                          |
| ------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET`   | `/health`                                                                             | liveness, version, whether push is configured                                    |
| `GET`   | `/targets`                                                                            | registry; filters: `tier`, `leverage`, `authTier`, `priority`, `search`, `limit` |
| `GET`   | `/targets/:id`                                                                        | one target with steps/legal basis                                                |
| `GET`   | `/stats`                                                                              | exposure progress: removed / submitted / awaiting-human / re-listed              |
| `POST`  | `/jobs`                                                                               | open a removal job (`subjectHash`, `targetId`)                                   |
| `GET`   | `/jobs`                                                                               | jobs joined to targets; filters `subjectHash`, `status`                          |
| `PATCH` | `/jobs/:id`                                                                           | status transition; increments `attempts` for the 3-strike rule                   |
| `POST`  | `/jobs/:id/observations`                                                              | record `found` / `not-found` — **field names only, never values**                |
| `POST`  | `/jobs/:id/submissions`                                                               | record a filed opt-out (`form` / `email`)                                        |
| `GET`   | `/push/vapid-public-key`, `POST`/`DELETE` `/push/subscribe`, `POST` `/push/dev-nudge` | push plumbing                                                                    |

```bash
curl -s localhost:8787/stats
curl -s 'localhost:8787/targets?priority=0&tier=enforceable'
```

## Registry

60 targets from two sources:

- **`packages/registry/data/enforceable.json`** — 11 hand-authored federal-law targets
  (credit freezes ×6, prescreen opt-out, DMA/ANA, HIBP). Not automatable by design; these are
  identity-verified and interactive.
- **`packages/registry/data/badbool.json`** — 51 entries derived from the vendored BADBOOL
  snapshot (11 💐 crucial, 5 ☠ high). See `packages/registry/vendor/badbool/PROVENANCE.md`. **CC
  BY-NC-SA 4.0** — that directory is not under the repo's terms, and this project cannot be
  productised while it vendors that list.

```bash
pnpm registry:vendor   # re-pin upstream, review the diff
pnpm registry:data     # regenerate badbool.json
pnpm seed              # load into SQLite
pnpm pii-scan          # assert no personal data landed in the metadata store
```

`pii-scan` checks the schema for PII-capable columns and scans runtime tables for email / phone
/ SSN shapes. Supply `PII_TERMS` or `--terms-file` (gitignored) for the real test against your
actual identity values.
