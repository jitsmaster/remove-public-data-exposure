-- Adds the columns the registry needs. Append-only: 001 already shipped to a public repo.
--
-- `leverage` keeps its two-value CHECK (high/normal); the finer ordering lives in `priority`
-- so that 💐 crucial and ☠ high-priority targets stay distinguishable without rebuilding a
-- table that `jobs` has a foreign key into.

ALTER TABLE targets ADD COLUMN priority INTEGER NOT NULL DEFAULT 2;
ALTER TABLE targets ADD COLUMN section TEXT;
ALTER TABLE targets ADD COLUMN opt_out_url TEXT;
ALTER TABLE targets ADD COLUMN source TEXT;
ALTER TABLE targets ADD COLUMN source_commit TEXT;
ALTER TABLE targets ADD COLUMN legal_basis TEXT;
ALTER TABLE targets ADD COLUMN automation TEXT;
ALTER TABLE targets ADD COLUMN steps_json TEXT;
ALTER TABLE targets ADD COLUMN flags_json TEXT;
ALTER TABLE targets ADD COLUMN links_json TEXT;

CREATE INDEX IF NOT EXISTS idx_targets_priority ON targets (tier, priority);

-- One domain, one target. The enforceable tier wins over a broker listing of the same
-- domain (optoutprescreen.com appears in both) because otherwise a removal produces a
-- duplicate job against the same form.
CREATE UNIQUE INDEX IF NOT EXISTS idx_targets_domain ON targets (domain);
