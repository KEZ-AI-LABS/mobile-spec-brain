# Architecture

The committed `.spec-brain/` directory is Mobile Spec Brain's only source of truth. It has a small, reviewable file protocol:

- `profile.json` — a cited project profile, proposed by an agent and approved by a human.
- `sources.json` — source roots that citations may address.
- `evidence/<shard>/<id>.json` — one immutable observation per citation-derived ID, except for verification state.
- `claims/<feature>/<id>.json` — open-world claims backed by existing evidence IDs.
- `concepts.json` — discovered vocabulary candidates.
- `events/<iso>-<uuid>.json` — append-only mutation and verification history.
- `extractions/<cache-key>.json` — one cache decision for an AI scope/extractor input.
- `spec/` and `.index/` — generated views and a rebuildable SQLite lookup index.

The CLI never scans Kotlin, Swift, Retrofit, navigation conventions, or product-specific names. `extract --scope --file` is an external-AI boundary: it accepts cited observations, calculates a key from scoped content and extractor/model/prompt versions, then either reuses the matching extraction record or independently validates every submitted range and hash.

Core keeps the existing generic resolution, mutation policy, ACL, safety, extraction-cache-key, invalidation, and open-world Entity/Claim/Relation primitives. They are policy utilities, not a second persistence model.
