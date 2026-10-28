# Provenance — BADBOOL

The files in this directory are **not** covered by the repository's licence. They are
third-party material, vendored verbatim for reproducibility.

| Field               | Value                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| Source              | [yaelwrites/Big-Ass-Data-Broker-Opt-Out-List](https://github.com/yaelwrites/Big-Ass-Data-Broker-Opt-Out-List) |
| Upstream branch     | `master`                                                                                                      |
| Commit              | `79f63fdc8a9791246af5e10865865aff584d809b` (see `COMMIT`)                                                     |
| Vendored on         | 2026-10-28                                                                                                    |
| `README.md` SHA-256 | `7d1095eaa3607d4423472bc111809ec8980f9564a456681448bf99d647db85ee`                                            |
| Author              | Yael Grauer                                                                                                   |
| Licence             | **CC BY-NC-SA 4.0** (full text in `LICENSE-BADBOOL.md`)                                                       |

## What the licence requires of us

1. **Attribution** — credit the author and link the source, in any redistributed form.
2. **NonCommercial** — this material must not be used commercially. This project is a
   personal tool; if that ever changes, the vendored list must be dropped first.
3. **ShareAlike** — derived data must carry the same licence. `data/badbool.json` is a
   derivative work and is therefore **CC BY-NC-SA 4.0**, not under the repo's terms. The
   file says so in its own `source` block.

## Changes we make

`scripts/import-badbool.mjs` transforms `README.md` into
`packages/registry/data/badbool.json`. It is a lossy normalisation, not an edit of
substance:

- headings parsed into `{ name, section }`
- emoji markers (💐 crucial, ☠ high priority, 🎫 ID required, 📞 phone required,
  💰 paid) split into structured flags
- the first opt-out-shaped link per entry extracted as `optOutUrl`; search-engine and
  reference links deprioritised
- `authTier` inferred from the entry prose (see the parser for the exact rules)
- free text truncated into `notes`

No entry is added, removed, or editorialised. Upstream corrections should be picked up by
re-vendoring, not by editing `badbool.json` by hand.

## Re-vendoring

```bash
pnpm --filter @rpde/registry vendor    # re-download README + LICENSE, record new commit
pnpm --filter @rpde/registry build:data  # regenerate badbool.json
```

Then review the diff. Upstream drops entries (Radaris and Rehold were removed for a court
order; OpenDataUSA's registration lapsed), so a diff is not automatically a regression.
