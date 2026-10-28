# Design

Removing personal-data exposure for two email addresses and the identity behind them,
driven from an Android PWA.

Status: design agreed, nothing built. Repo is empty apart from this doc and
`IMPLEMENTATION_PLAN.md`.

---

## 1. What this is, and what it is not

**Is:** a two-tier exposure-reduction ledger. One tier exercises rights you actually
have under US federal law. The other submits best-effort opt-out requests to data
brokers, verifies them, and detects when they come back.

**Is not:**

- A web scraper that finds "everyone who has your email." That set is not observable.
  Brokers hold paywalled records keyed on name + address and will never enumerate them
  for you. Only three things are observable: a broker's own search endpoint returning a
  hit, an indexed page exposing the tuple, and a removal receipt.
- An inbox/spam measurement tool. That goal was dropped — it requires
  `gmail.readonly` on an account holding an entire life, for a metric that is noisy and
  slow to move.
- A CAPTCHA-defeating system. A human solves every challenge.
- A California-grade erasure service. See §2.1.

Roughly 40% of the original ask is gone because it was unobservable or unlawful. That is
the design working, not scope creep in reverse.

---

## 2. Constraints that shaped this design

These are verified facts, not assumptions. They are the reason the architecture looks the
way it does.

### 2.1 Washington has no comprehensive consumer privacy law

The Washington AG's own privacy report states the state "has not enacted a comparable,
generally applicable consumer privacy law." HB 1671 (Washington Privacy Act) has failed
repeatedly and remains in committee; its proposed enforcement date is Aug 2026 _if_ it
ever passes. What does exist is `RCW 19.373`, the **My Health My Data Act** — strong
(private right of action under the Consumer Protection Act, statutory right to delete)
but scoped to _consumer health data_. An email address is not health data.

**Consequence:** no statutory deletion right, no response deadline, no regulator to
escalate to. Every broker opt-out is a request a broker may ignore lawfully. This is why
the design does not pretend the broker tier is enforcement, and why the enforceable tier
exists at all.

Sources: WA AG Data Privacy Report (`agportal-s3bucket.s3.us-west-2.amazonaws.com/Data%20Privacy/DPR_2026_final.pdf`),
DataGuidance Washington jurisdiction page, IAPP 2025 state law survey.

### 2.2 Brokers index people, not email addresses

Data brokers key records on **name + physical address + phone** and derive email as an
attribute. Querying with only an email address returns a thin slice — often zero, or a
marketing-opt-out page with no record behind it.

**Consequence:** the identity tuple is full (name, aliases, addresses, phones, DOB), and
the two email addresses are secondary keys. Email-only searching was explicitly rejected;
it caps recall at roughly 10–25% of broker profiles.

### 2.3 Most opt-outs do not complete without a mailbox click

The dominant flow is: submit form → "check your email to confirm" → click link → removal
proceeds. Ignore it and the request expires. Email-based erasure requests are a reply
thread with the same property.

**Consequence:** the worker needs mailbox access for a narrow purpose — closing
verification loops — not for reading mail. Solved by a one-way Gmail filter into a
dedicated address (§5.3).

### 2.4 CAPTCHA and IP reputation are two independent problems

Nearly every meaningful broker opt-out form sits behind reCAPTCHA, hCaptcha, or
Cloudflare Turnstile. Separately, most of those sites are Cloudflare-fronted and block
datacenter IP ranges outright — a VPS gets a challenge wall on request one regardless of
CAPTCHA strategy.

**Consequence:** the worker runs on the user's residential IP, in a stock browser, and a
human solves every challenge. See §5.1.

### 2.5 A PWA cannot scrape, submit forms, or run background work

Browser sandbox: no cross-origin scraping, no form submission on other origins, no DOM
automation, no real background execution when closed. Android additionally kills
background sync, leaving **Web Push as the only reliable wake mechanism**.

**Consequence:** the PWA is a remote control and a vault. All fetching and submitting
happens in an out-of-browser worker.

### 2.6 Bing's search API no longer exists

Microsoft retired the Bing Search and Bing Custom Search APIs on 11 Aug 2025 with no
drop-in replacement. Google Custom Search JSON API allows 100 queries/day — too tight for
a sweep.

**Consequence:** Brave Search API (independent index, ~1,000 queries/month free tier) is
the sweep engine.

### 2.7 Removals decay

Brokers re-ingest from public records on a 3–6 month cycle; some re-add within weeks. It
is why DeleteMe charges annually and re-checks quarterly, and Incogni re-scans monthly. A
one-shot run has a ~4-month half-life.

**Consequence:** the product is a state machine with re-listing as its headline metric,
not a one-shot tool.

### 2.8 Most "brokers" are resellers

A handful of upstream sources feed hundreds of downstream people-search sites. Opting out
of 300 resellers while missing the 5 sources is the classic wasted-effort failure. The
BADBOOL list already encodes this with its ☠️ leverage marker.

---

## 3. The two-tier model

Tiers are separated by **legal strength**, not difficulty. The ledger covers both; only
one tier has teeth.

### Tier 1 — Enforceable (federal rights)

| Action                                        | Legal basis                          | Automatable                             |
| --------------------------------------------- | ------------------------------------ | --------------------------------------- |
| Credit freeze — Equifax, Experian, TransUnion | FCRA, 15 U.S.C. §1681c-1             | No — identity-verified by design        |
| Credit freeze — Innovis, ChexSystems, NCTUE   | Same, plus deposit/telecom reporting | No                                      |
| Opt out of prescreened credit offers          | FCRA §1681b(e), optoutprescreen.com  | Partly (form + mail-back for permanent) |
| DMA / ANA marketing-list opt-outs             | Industry, not law                    | Yes                                     |
| Data-breach notification subscriptions (HIBP) | N/A                                  | Yes                                     |

This tier is a **guided wizard plus ledger**: deep links, pre-filled context, status
tracking, and nagging until done. It is not a robot, and pretending otherwise would be
the single most dishonest part of the product. Values here are near-permanent and the
work is measured in minutes.

### Tier 2 — Voluntary (broker opt-outs)

BADBOOL-seeded registry, queried by identity tuple, removals submitted through forms,
CAPTCHAs solved by the human, confirmations closed via the mailbox forwarder, re-listing
detected on a schedule.

No legal backing in Washington. Expect a meaningful share of targets to ignore requests
lawfully. The ledger records that as a state (`ignored`) rather than hiding it.

---

## 4. Architecture

### 4.1 Topology — split origins

The PWA shell is static and PII-free; the data plane is private.

```
┌─────────────────────────┐        ┌──────────────────────────────────┐
│  Cloudflare Pages       │        │  Home box (always on)            │
│  static PWA shell       │        │  residential IP                  │
│  - no PII               │        │                                  │
│  - valid cert, installs │        │  ┌────────────────────────────┐  │
│  - Web Push origin      │        │  │ Worker (Node)              │  │
└───────────┬─────────────┘        │  │  - Playwright/Chromium     │  │
            │                      │  │  - registry adapters       │  │
            │  Web Push (FCM)      │  │  - scheduler               │  │
            ▼                      │  │  - batch packet in RAM     │  │
┌─────────────────────────┐        │  └────────────┬───────────────┘  │
│  Android phone (PWA)    │        │               │                  │
│  - IndexedDB vault      │◄───────┤  SQLite: job metadata only       │
│  - non-extractable key  │Tailscale│  (no PII)                       │
│  - app lock             │  mesh  │                                  │
│  - handoff UI           │        │  Forwards inbox (broker mail)    │
└─────────────────────────┘        └──────────────────────────────────┘
```

Why split: a PWA installs only from a stable HTTPS origin with a valid cert, and Web Push
needs one too. Serving that origin publicly is fine **as long as it carries no data** —
the shell is UI only. All PII moves over Tailscale, and the home box is never
internet-reachable.

Rejected alternatives: Cloudflare Tunnel (puts the same vendor whose bot protection we
stopped fighting directly in the PII path); all-on-Tailscale (`*.ts.net` origin — single
deploy, but push arrives and cannot reach the box when the tunnel is down); LAN-only
(kills the phone).

### 4.2 Components

| Component        | Runs where         | Responsibility                                        | Holds PII              |
| ---------------- | ------------------ | ----------------------------------------------------- | ---------------------- |
| PWA shell        | Cloudflare Pages   | UI, service worker, push receiver                     | No                     |
| Vault            | Device (IndexedDB) | Identity tuple, encrypted, non-extractable key        | Yes                    |
| Handoff UI       | Device             | CAPTCHA challenge presentation, resume trigger        | Transiently            |
| Orchestrator API | Home box           | Job queue, state transitions, diffing                 | No (metadata only)     |
| Worker           | Home box           | Playwright automation, form submission                | Transiently, RAM only  |
| Search adapter   | Home box           | Brave Search sweep                                    | Query terms only       |
| Mailbox reader   | Home box           | Parses forwarded broker confirmations, extracts links | Links + broker domains |
| Mail forwarder   | Gmail (user-owned) | One-way filter: broker domains → dedicated address    | n/a                    |

### 4.3 Stack

TypeScript monorepo. SvelteKit PWA on Cloudflare Pages. Node + Playwright worker and
orchestrator on the home box, reachable only over Tailscale. SQLite for job metadata.
IndexedDB + WebCrypto for the vault. BADBOOL vendored as version-pinned data. Brave
Search API for the sweep.

---

## 5. The three risky seams

Everything else in this design is ordinary work. These three are where it fails if it
fails.

### 5.1 Human-in-the-loop CAPTCHA handoff

**Shape.** Worker drives the form to the challenge, stops, screenshots the widget, pushes
a deep link to the phone. The PWA shows the challenge in a live view, the human solves it,
the worker resumes and submits.

**Why not solve it programmatically.** Paid solver services violate the CAPTCHA vendors'
terms, burn the egress IP, and decay monthly. More importantly: **once a human is solving
the challenge, stealth tooling buys almost nothing** — the thing it exists to defeat is
the thing we've stopped fighting. That argument is what settled the "no evasion" posture.

**Requirements:**

- Live-hold session: the Chromium context stays open while waiting for a human. This
  means N concurrent held browsers during a batch and a timeout/abandon policy.
- Screenshot streaming to the phone, plus an input channel back to the browser session.
  Needs to survive the phone sleeping — jobs hold, they do not fail.
- Per-broker timeout (suggest 15 min) after which the job degrades to assisted-manual.
- Three automation failures on the same broker ⇒ that broker is permanently demoted to
  assisted-manual until its adapter is fixed.

**The hard part** is not the CAPTCHA. It is maintaining a live interactive browser session
across a network boundary to a phone that sleeps, for a target that may redesign its page
at any time. Budget accordingly.

**Interaction channel options** (undecided, see §11): screenshot polling for simplicity vs.
a CDP-over-WebSocket proxy for true interactivity. Polling is far simpler and probably
sufficient, since the human only needs to solve one widget.

### 5.2 PII boundary and the batch packet

**Rule:** PII is never persisted server-side.

| Data                                                           | Location                                                | Lifetime                                          |
| -------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| Identity tuple (name, aliases, addresses, phones, DOB, emails) | Device vault, AES-GCM, non-extractable key in IndexedDB | Indefinite, user-controlled                       |
| Batch packet (decrypted tuple)                                 | Home box RAM, tmpfs, no swap                            | Duration of batch, then discarded                 |
| Job metadata (broker id, status, timestamps, attempt counts)   | Home box SQLite                                         | Indefinite                                        |
| Subject key (salted hash of identity)                          | Home box SQLite                                         | Indefinite — used to key jobs without identifying |
| Confirmation artifacts (links, receipts)                       | Device vault                                            | Indefinite                                        |
| Screenshots from handoff                                       | Discarded after job closes                              | Minutes                                           |

**Operational requirements:**

- Worker process: `--max-old-space-size` set, no core dumps, swap disabled or tmpfs-backed,
  request-body logging off, Playwright trace/HAR capture off (traces contain PII and
  screenshots — this is the most likely accidental leak).
- Orchestrator never accepts PII on any endpoint that writes to SQLite; the type system
  should make this unrepresentable, not merely discouraged.
- The batch packet is pushed from device to worker at batch start over Tailscale. If the
  phone is unreachable, jobs pause rather than retry with stale data.

**Accepted trade-off:** a stalled phone stalls the batch. This is fine precisely because
§5.1 already requires the phone for every CAPTCHA. A job that cannot reach the human was
already blocked.

**Worth saying plainly:** "encrypted on device" here is weaker than it sounds. A PWA has
no Android Keystore. A non-extractable WebCrypto key in IndexedDB cannot be read out by
JS, which is genuinely decent, but it is origin-bound rather than hardware-bound. Do not
describe this as hardware-backed. And call `navigator.storage.persist()` — Chrome evicts
IndexedDB under pressure, and the entire vault lives there.

### 5.3 Mailbox verification loop

**Setup (user, one time):** a Gmail filter matching broker and deletion domains forwards
to a dedicated address the worker reads (own-domain inbox or inbound-parse webhook).

**Why this shape:** it closes confirmation loops without `gmail.readonly` on the real
account. The worker sees broker replies and nothing else. Least privilege, and it is
genuinely automatable.

**Flow:** worker polls/consumes inbound mail → matches sender domain to a pending job →
extracts confirmation link or reply address → completes it → records receipt → transitions
job to `submitted` → schedules verification re-check.

**Risks:** forwarded mail carries the confirmation token, so the forwarded inbox is a
capability store — treat it as secret, restrict it, and prefer a dedicated domain that can
be rotated. Also: some brokers require ID or a notarised form, which no filter helps with;
those jobs become `id-required` and go to the user as a task.

---

## 6. Data model

Device (encrypted vault):

```
Identity      { fullName, aliases[], addresses[], phones[], dob, emails[] }
VaultKey      non-extractable AES-GCM CryptoKey (IndexedDB)
Artifact      { jobId, kind: 'receipt'|'screenshot'|'letter', blob|url, capturedAt }
```

Home box (metadata only — no PII, keyed by subject hash):

```
Subject       { hash, createdAt }
Target        { id, name, domain, tier: 'enforceable'|'broker', leverage: 'high'|'normal',
                authTier: 'email'|'form'|'captcha'|'id-required', adapter?: string,
                badboolVersion, notes }
Job           { id, subjectHash, targetId, status, attempts, lastAttemptAt,
                nextCheckAt, failureReason? }
Observation   { id, jobId, observedAt, result: 'found'|'not-found', fields[], sweepSource? }
Submission    { id, jobId, submittedAt, channel: 'form'|'email', confirmationRef? }
```

Job statuses:

```
pending → searching → found → queued → awaiting-challenge → submitting → awaiting-confirm
        → submitted → verifying → removed
                                          ↘ re-listed → (requeues removal)
        ↘ not-found (re-check next cycle)   ↘ ignored (no response; retry policy)
        ↘ failed (attempts exhausted)       ↘ assisted-manual / id-required
```

---

## 7. The re-listing loop

- **Broker search re-checks:** scheduled, frequent, cheap. Querying a broker's search
  endpoint is unchallenged; it is the _opt-out_ that is CAPTCHA'd.
- **Search-engine sweep:** quarterly, or on demand. Brave Search API only. Google and
  Bing prohibit automated querying and will IP-ban the residential address — which would
  also poison the egress IP the removal pipeline depends on. This is a real coupling, not
  a theoretical one.
- **Diffing:** each observation snapshot diffed against the prior one. New appearance of a
  previously-removed subject ⇒ `re-listed` ⇒ auto-requeue a removal job.
- **Headline metric:** percent of confirmed removals still holding at 30/90/180 days. Not
  "sites found." Sites found is an unflattering number that grows forever and means
  nothing.

---

## 8. Failure modes and degradations

| Failure                      | Behaviour                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| Broker blocks the IP         | Target marked unreachable; sweep and removals pause; surfaced to user                 |
| Page markup changed          | Adapter throws typed error; 3 strikes ⇒ assisted-manual; adapter flagged for repair   |
| Challenge times out          | Job degrades to assisted-manual with a deep link                                      |
| Phone unreachable            | Job holds; batch pauses; no stale retry                                               |
| Forwarder inbox down         | Confirmations accumulate; jobs sit in `awaiting-confirm`, not failed                  |
| Broker ignores request       | `ignored` after a defined window; recorded honestly, not as success                   |
| Broker demands ID            | `id-required`; surfaced to user as a task with instructions                           |
| Vault evicted from IndexedDB | Detect on unlock; require re-entry. `storage.persist()` should prevent, not guarantee |
| Tailscale down on phone      | Push arrives, cannot reach box; queued server-side until reconnect                    |
| Brave quota exhausted        | Sweep defers to next quarter; broker checks unaffected                                |

---

## 9. Security posture and threat model

**The threat that matters most:** this app, not the brokers, becomes the best single
target for identity theft. One device holds name, every address ever lived at, phones,
DOB, and two emails. The design reduces that to a device-only blast radius, but it does
not eliminate it.

Mitigations in scope: device-only vault; non-extractable keys; app lock; no PII in SQLite;
no traces or HAR files; no request-body logging; RAM-only batch packet; `storage.persist()`;
narrow one-way mail filter; box not internet-reachable (Tailscale only); no stealth or
proxy tooling that would attract adversarial attention.

Accepted residual risks, stated rather than hidden: a compromised phone yields everything;
a compromised home box yields in-flight PII during a batch; the forwarded-mail inbox is a
capability store; and a non-extractable key is origin-bound, not hardware-bound.

---

## 10. Deliberate non-goals

- Measuring spam volume or reading the real mailbox.
- Enumerating private/paywalled/derived data holdings.
- Deepfaking a jurisdiction to manufacture a deletion right.
- Circumventing CAPTCHAs, fingerprint checks, or Cloudflare bot management.
- Multi-user. Single subject, single device.
- iOS. Android install target only (the PWA will technically load elsewhere; it is not
  supported, and Web Push differences make it untestable).
- Real-time everything. The value is in the ledger and the loop.

---

## 11. Open questions (not yet decided)

1. **How is "removed" verified?** Currently assumed: a re-query returning `not-found` after
   N days. Weak — a broker may suppress a record from search while retaining it. No better
   signal exists without a legal right to confirm, which Washington does not grant. Decide
   an N and be honest in the UI.
2. **Re-list detection heuristics** — how many consecutive `not-found` observations before a
   target counts as removed vs. flaky search.
3. **Handoff channel** — screenshot polling vs. CDP-over-WebSocket (§5.1).
4. **Cost ceiling** — Brave tier, tailscale, domain, and whether any target justifies a paid
   proxy or solver. Current design says no.
5. **Retry/abandon policy** for `ignored` targets — how many attempts before it stops.
6. **PII re-entry UX** if the vault is evicted.
