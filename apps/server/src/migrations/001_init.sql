-- Job metadata only. There is deliberately no column anywhere in this schema that can
-- hold a name, address, phone number, date of birth, or email address. If a migration ever
-- needs one, the design in DESIGN.md §5.2 has been violated — stop and rethink.
--
-- Subjects are identified by a salted hash computed on the device.

CREATE TABLE IF NOT EXISTS subjects (
  hash        TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS targets (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  domain           TEXT NOT NULL,
  tier             TEXT NOT NULL CHECK (tier IN ('enforceable', 'broker')),
  leverage         TEXT NOT NULL CHECK (leverage IN ('high', 'normal')),
  auth_tier        TEXT NOT NULL CHECK (auth_tier IN ('email', 'form', 'captcha', 'id-required')),
  adapter          TEXT,
  badbool_version  TEXT,
  notes            TEXT,
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_targets_tier ON targets (tier, leverage);

CREATE TABLE IF NOT EXISTS jobs (
  id             TEXT PRIMARY KEY,
  subject_hash   TEXT NOT NULL,
  target_id      TEXT NOT NULL REFERENCES targets (id),
  status         TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  next_check_at  TEXT,
  failure_reason TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status, next_check_at);
CREATE INDEX IF NOT EXISTS idx_jobs_target ON jobs (subject_hash, target_id);

-- Field names only, never field values (see packages/shared Observation).
CREATE TABLE IF NOT EXISTS observations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        TEXT NOT NULL REFERENCES jobs (id),
  observed_at   TEXT NOT NULL,
  result        TEXT NOT NULL CHECK (result IN ('found', 'not-found')),
  fields        TEXT NOT NULL DEFAULT '[]',
  sweep_source  TEXT
);

CREATE INDEX IF NOT EXISTS idx_observations_job ON observations (job_id, observed_at);

CREATE TABLE IF NOT EXISTS submissions (
  id              TEXT PRIMARY KEY,
  job_id          TEXT NOT NULL REFERENCES jobs (id),
  submitted_at    TEXT NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('form', 'email')),
  confirmation_ref TEXT
);

-- Push endpoints are capability URLs. They are not identity data, but they are secrets:
-- anyone holding one can push to the device.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint    TEXT PRIMARY KEY,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  label       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  revoked_at  TEXT
);
