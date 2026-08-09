# Mobile Spec Brain

Mobile Spec Brain is an evidence-first, local repository protocol for mobile delivery. It does not infer a hidden database model from Android or iOS code. An AI (or another extractor) submits an open observation and a closed citation; the CLI re-reads that range, verifies its hash, and persists the result as reviewable files.

`.spec-brain/` is the source of truth and is intended to be committed. `.spec-brain/.index/` and `.spec-brain/spec/` are derived and ignored.

## Workflow

```sh
pnpm install
pnpm spec-brain init
pnpm spec-brain profile propose --file profile.json
# A human reviews profile.json and changes status from PROPOSED to APPROVED.
pnpm spec-brain extract --scope src
pnpm spec-brain evidence record --file evidence.json
pnpm spec-brain claim propose --file claim.json
pnpm spec-brain verify
pnpm spec-brain reindex
pnpm spec-brain spec render transfer
```

`profile.json` entries have citations too. Evidence may be recorded only after human profile approval. `evidence record` rejects a path that escapes its source root, a missing range, or a mismatched content hash. `verify` marks changed citations `STALE`, missing citations `ORPHANED`, and dependent active claims `NEEDS_REVIEW`.

The external extraction boundary is deliberately narrow:

```json
{
  "citation": { "sourceId": "project", "path": "src/Transfer.kt", "range": [12, 15], "contentHash": "sha256:<64 hex chars>", "revision": "git-or-local-revision" },
  "kind": "network-wrapper",
  "observation": { "summary": "Open, AI-proposed observation" },
  "extractor": { "id": "agent", "version": "1", "model": "optional", "promptVersion": "optional" },
  "confidence": 0.8,
  "authority": 0.6
}
```

No fixed Android, iOS, Retrofit, navigation, or product-domain extractor is part of the CLI. The bundled OpenAPI and Figma adapters are deterministic source readers only; they do not become the canonical model or make implementation claims.

## Commands

`profile read|propose`, `evidence record|query`, `claim propose|supersede`, `graph query`, `extract --scope`, `verify`, `reindex`, `coverage`, and `spec render <feature> [--section predicate]`.

`spec render` creates deterministic JSON and Markdown views containing claims, full evidence citations and states, unresolved items, and completeness. It never fills missing product facts.

## Verification

```sh
pnpm check
pnpm test
```

The end-to-end CLI test proves invalid-citation rejection, source change propagation, index rebuild, and stable render output using a real child process.
