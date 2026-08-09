# Workflow

A worked example of adopting Mobile Spec Brain in an existing mobile repository. Every command and output below was
run against a real repository.

## What this buys you

Documentation that cannot silently lie. When someone changes a cited line, `verify` marks the evidence `STALE`, the
claims that depend on it `NEEDS_REVIEW`, and the rendered spec drops to a lower completeness. A stale document
becomes a failing check rather than something a reader has to notice.

That is the whole value. If your team does not have a documentation-drift problem worth a CI job, you do not need
this.

## One-time setup

```sh
cd your-android-repo
npx spec-brain init
git add .spec-brain && git commit -m "chore: initialize spec brain"
```

`.spec-brain/` is committed. `.spec-brain/spec/` is generated and ignored.

## Step 1 — Propose a profile, and have a human approve it

The profile records how this codebase does things, with citations. An agent proposes it; a human approves it by
editing the file. Nothing else can be recorded until that happens.

```sh
spec-brain cite app/src/main/java/com/bank/transfer/TransferApi.kt 4 4
```

```json
{
  "status": "complete",
  "citation": {
    "sourceId": "project",
    "path": "app/src/main/java/com/bank/transfer/TransferApi.kt",
    "range": [4, 4],
    "contentHash": "sha256:346c4134b655eb1f2548cbfc94ff8146c7813cdb75add9685b32cef024586832",
    "revision": "6c6056f"
  }
}
```

`cite` reads the range through the same code path verification uses, so a citation it produces cannot fail its own
hash check. Never assemble a citation by hand — the hash covers the exact joined line range, and the revision is
read from git.

Put the citation into `profile.json`:

```json
{
  "entries": [
    {
      "key": "network.style",
      "value": "Retrofit suspend + Response<T>",
      "citations": [
        { "sourceId": "project", "path": "...", "range": [4, 4], "contentHash": "sha256:...", "revision": "6c6056f" }
      ]
    }
  ]
}
```

```sh
spec-brain profile propose --file profile.json
# A human reviews .spec-brain/profile.json and changes "status" to "APPROVED".
```

## Step 2 — Let an agent extract observations

Copy [`.claude/commands/spec-brain-extract.md`](../.claude/commands/spec-brain-extract.md) into the target
repository and run `/spec-brain-extract <scope>`. The agent reads the code, calls `spec-brain cite` for every range
it wants to reference, and writes a proposal:

```json
{
  "extractor": { "id": "claude-code", "version": "1", "model": "opus-5", "promptVersion": "p1" },
  "observations": [
    {
      "citation": {
        "sourceId": "project",
        "path": "...",
        "range": [4, 7],
        "contentHash": "sha256:...",
        "revision": "6c6056f"
      },
      "kind": "retrofit-endpoint",
      "observation": {
        "httpMethod": "POST",
        "path": "/api/v2/transfers",
        "function": "createTransfer",
        "returns": "Response<TransferResult>"
      },
      "extractor": { "id": "claude-code", "version": "1" },
      "confidence": 0.95,
      "authority": 0.6
    }
  ]
}
```

```sh
spec-brain extract --scope app --file proposal.json
```

The CLI re-reads and re-hashes every cited range. An observation the agent invented — a plausible path that is not
actually in the file — is rejected here, not merged and discovered later. Re-running with unchanged sources and the
same extractor, model, and prompt versions reuses the previous result instead of re-recording.

## Step 3 — Record claims

Evidence is what the code says. A claim is what your team asserts, backed by evidence IDs:

```json
{
  "id": "transfer-create-api",
  "feature": "transfer",
  "predicate": "api.contract",
  "object": {
    "method": "POST",
    "path": "/api/v2/transfers",
    "displayName": "송금 생성",
    "parameters": [],
    "responses": { "200": { "type": "TransferResult" } }
  },
  "evidenceIds": ["ev_51a80841..."],
  "state": "ACTIVE",
  "recordedAt": "2026-08-09T14:39:31.204Z"
}
```

```sh
spec-brain claim propose --file claim.json
spec-brain spec render transfer
```

## Step 4 — Gate CI on drift

```yaml
- run: npx spec-brain verify --fail-on-drift
```

`--fail-on-drift` exits 1 while any evidence is `STALE` or `ORPHANED`, or any claim is `NEEDS_REVIEW`. It reports the
current state rather than only this run's transitions, so a second run does not pass just because the first already
recorded the downgrade. Without the flag `verify` always exits 0, which is what you want when you only need the JSON
report.

Here is the failure a real change produces. Someone bumps the endpoint to `v3`:

```
$ spec-brain verify --fail-on-drift
{
  "status": "complete",
  "stale": ["ev_51a80841bc55cf311b21e65108dd875cd85050d8d6a8494abb2a55266ebea30d"],
  "orphaned": [],
  "claimsNeedingReview": ["transfer-create-api"],
  "drift": true
}
$ echo $?
1
```

And the rendered document stops claiming to be current:

```
- Completeness: 0.0% (0 known / 1 unknown, 1 stale)
- POST /api/v2/transfers · **NEEDS_REVIEW** · evidence: `ev_51a80841...`
```

## Step 5 — Resolve drift

Drift is resolved by a human decision, never automatically:

- **The code is right and the claim is out of date** — record new evidence at the new lines, then
  `claim supersede` with a claim pointing at it.
- **The code is wrong** — fix the code; `verify` returns the evidence to `ACTIVE` on its own.
- **The evidence should never have been recorded** — `spec-brain evidence invalidate --id <id> --confirm-human`.

## Cost and honest limits

Per feature this is roughly one profile approval, one agent extraction, and a handful of claim files. The recurring
cost is resolving drift, which is the work you wanted to be forced to do.

What this does not do:

- It does not author claims for you. `extract` produces observations; turning those into asserted contracts is a
  human or agent decision recorded as a claim.
- It does not diff Android against iOS. Both can be cited into the same feature, and a missing platform shows up as
  an unknown, but nothing computes the comparison for you.
- It has no Figma, Slack, or Confluence adapter. `sourceId` is designed for more than one source root, but only
  local file sources are implemented.
- `revision` is provenance metadata; a dirty working tree still reports the last commit. The content hash is what
  verification actually checks.
