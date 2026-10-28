# remove-public-data-exposure

An Android-only PWA plus a residential-IP worker that inventories and reduces personal-data
exposure for one person's identity — name, addresses, phones, DOB, and two email addresses.

Two tiers, separated by **legal strength**, not difficulty:

| Tier | What | Legal basis |
|---|---|---|
| **Enforceable** | Credit freezes ×6, prescreened-offer opt-out, DMA/ANA lists, breach notifications | US federal law (FCRA) |
| **Voluntary** | ~hundreds of data-broker opt-outs, verified and re-checked | None in Washington — these are *requests* |

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

Design complete. Nothing built. See `IMPLEMENTATION_PLAN.md` M0.
