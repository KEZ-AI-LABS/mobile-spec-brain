---
description: Explore a project and produce one cited Mobile Spec Brain analysis bundle
argument-hint: [optional focus or adoption question]
allowed-tools: Bash(spec-brain:*), Bash(pnpm spec-brain:*), Read, Glob, Grep, Write
---

Analyze the configured project as a whole and write `project-analysis.json`. `$ARGUMENTS` is an optional focus hint,
not a correctness scope. Do not imply that paths outside the hint were analyzed unless you actually inspected them.

## Trust rules

1. Never compute or invent `contentHash`. Obtain every citation with
   `spec-brain cite <path> <start-line> <end-line>` and copy the returned object verbatim.
2. Cite the narrowest range that directly supports an observation.
3. Keep observations descriptive. Claims express the proposed team meaning and remain human-reviewed.
4. Record every inspected path in `filesRead`; record deliberately skipped or unavailable sources in `excluded`.
5. Never guess missing product, design, API, implementation, or navigation knowledge. Use `UNKNOWN` or
   `SOURCE_UNAVAILABLE`; use `NOT_APPLICABLE` only when the project provides evidence that the section does not apply.
6. Reuse concepts from `.spec-brain/concepts.json` where possible, but keep semantic vocabulary open.

## Steps

1. Run `spec-brain analysis contract`.
2. Read `.spec-brain/sources.json`, `.spec-brain/profile.json`, and `.spec-brain/concepts.json`.
3. Explore the repository structure and discover feature candidates. Use Git changes and existing citations to
   prioritize a refresh, but do not require the user to register features or choose a scope.
4. Inspect the files needed to understand each feature and obtain citations through `spec-brain cite`.
5. Write one bundle containing repository/extractor provenance, `filesRead`, `excluded`, optional cited profile
   entries, discovered features, all five coverage sections, keyed evidence, and claims referencing evidence keys.
6. Run `spec-brain analysis validate --file project-analysis.json`.
7. Report the proposed features, unavailable sources, unknowns, and review risks. Do not run `analysis ingest` yourself;
   a human reviews the bundle and invokes it with `--confirm-human`.
