# Spec amendments

Changes the project owner made to `spec.md`. Where an amendment and the spec differ, the amendment wins.

## A1 — Outline tier, breadth first (2026-10-22)

**Decision (project owner):** populate the globe with many lightweight records first, then add detail later.

- A record may be published as an **outline**: `tier: "outline"`, which `publish.mjs` turns into `status: "outline"`. An outline carries `id`, `title`, `kind`, `summary` (15–90 words, written fresh), `when` (start, end, precision, display, `as_recorded` with source), `where` (lat, lon, modern and historical name, `uncertainty_km`, ≥ 1 coordinate source), `regions`, `domains`, `scale`, `importance` with justification, `confidence`, `audience_note` where graphic, `reviewer_note`, and ≥ 2 opened sources from 2 publishers (at least one not class `other`). `related` links are optional.
- **The accuracy rules are unchanged.** Every date, place and number still comes from a page the agent opened. Nothing is invented; a gap stays a gap.
- **Viewers show outlines as distinct "outline" pins**, labelled as not yet full records. This relaxes spec 11 ("visitors see only `status: published`") for outlines only.
- Every published outline stays in the queue as an `enrichment` / `upgrade-outline` target. The normal loop later rewrites it to a full record, removing `tier`, passing the full quality gate (spec 10), and republishing under the same id.
- Outlines don't count toward the every-50 progress report or the every-100 audit. The 40% Europe and North America balance rule applies to outlines too: the outline queue is filled from under-covered regions first.
