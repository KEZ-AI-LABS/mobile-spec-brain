# Mobile Spec Brain

Mobile Spec Brain is an evidence-first, local repository protocol for mobile delivery. It does not infer a hidden
database model from Android or iOS code. An AI (or another extractor) submits an open observation and a closed
citation; the CLI re-reads that range, verifies its hash, and persists the result as reviewable files.

`.spec-brain/` is the source of truth and is intended to be committed. `.spec-brain/spec/` is derived and ignored.

## Workflow

```sh
pnpm install
pnpm spec-brain init
pnpm spec-brain profile propose --file profile.json
# A human reviews profile.json and changes status from PROPOSED to APPROVED.
pnpm spec-brain extract --scope src --file extraction-proposal.json
pnpm spec-brain evidence record --file evidence.json
pnpm spec-brain claim propose --file claim.json
pnpm spec-brain verify
pnpm spec-brain spec render transfer
```

`profile.json` entries have citations too. Evidence may be recorded only after human profile approval.
`evidence record` rejects a path that escapes its source root — lexically or through a symbolic link — a missing
range, or a mismatched content hash. `verify` marks changed citations `STALE`, missing citations `ORPHANED`, and
dependent active claims `NEEDS_REVIEW`.

The external extraction boundary is deliberately narrow:

```json
{
  "citation": {
    "sourceId": "project",
    "path": "src/Transfer.kt",
    "range": [12, 15],
    "contentHash": "sha256:<64 hex chars>",
    "revision": "git-or-local-revision"
  },
  "kind": "network-wrapper",
  "observation": { "summary": "Open, AI-proposed observation" },
  "extractor": { "id": "agent", "version": "1", "model": "optional", "promptVersion": "optional" },
  "confidence": 0.8,
  "authority": 0.6
}
```

No fixed Android, iOS, Retrofit, navigation, or product-domain extractor is part of the CLI. `extract --scope --file`
accepts an AI-generated `{ extractor, observations }` proposal, validates every citation, and stores a committed
extraction-cache record. The same scope contents plus extractor/model/prompt versions reuse the existing evidence
rather than re-extracting, up to 1000 observations per extraction.

An evidence ID is derived from the citation, the observation `kind`, and the observation body, so two different
observations about the same lines are two records and an identical observation recorded twice is one.

## Commands

| Command                                         | Purpose                                                 |
| ----------------------------------------------- | ------------------------------------------------------- |
| `init`                                          | Create `.spec-brain/` in the current directory          |
| `profile read\|propose`                         | Read or propose the cited project profile               |
| `evidence record\|query`                        | Record a cited observation, or query stored evidence    |
| `evidence invalidate --id <id> --confirm-human` | Mark evidence `INVALIDATED` and review dependent claims |
| `claim propose\|supersede`                      | Record a claim, or supersede an earlier one             |
| `graph query`                                   | Filter claims by feature, predicate, or state           |
| `extract --scope <path> [--file <proposal>]`    | Preview an extraction key, or submit a proposal         |
| `verify`                                        | Re-read every citation and propagate state              |
| `coverage`                                      | Count sources, evidence states, and claim states        |
| `spec render <feature> [--section <name>]`      | Write the derived JSON and Markdown views               |

`spec render` creates deterministic JSON and Markdown views containing claims, full evidence citations and states,
unresolved items, and completeness. Generic claims whose object has `{ method, path }`, `{ nodeId, name }`,
`{ platform, status }`, or `{ direction, route }` project into API, Figma, implementation, and navigation sections
without adding concept-specific recording commands. `--section api|figma|implementation|navigation|unknowns` narrows
the render to one projection while keeping its provenance. It never fills missing product facts.

## Verification

```sh
pnpm check
pnpm test
```

`pnpm check` runs the formatter check, the build, `tsc --noEmit`, and ESLint. The end-to-end CLI test proves
invalid-citation rejection, source change propagation, section narrowing, human-gated invalidation, and stable render
output using a real child process.
