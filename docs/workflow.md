# Team adoption workflow

This workflow is designed for an existing mobile repository. The team configures project sources once. An AI explores
the project, discovers features, and returns one review bundle; developers do not register every feature or choose a
correctness scope.

## 1. Initialize

From this source checkout, build the CLI and run it in the target repository:

```sh
pnpm install
pnpm build
cd /path/to/mobile-repository
node /path/to/mobile-spec-brain/apps/cli/dist/main.js init
```

Commit `.spec-brain/`. Generated `.spec-brain/spec/` remains ignored.

## 2. Let an AI analyze the project

The agent starts at the repository root, reads `.spec-brain/sources.json`, explores the configured sources, and records
every path it actually read. It may internally chunk a large repository, but it must return one protocol-complete
bundle and explicitly label unavailable knowledge.

Use [the bundled Claude command](../.claude/commands/spec-brain-analyze.md) or give another agent the output of:

```sh
spec-brain analysis contract
```

For every factual observation, the agent obtains a citation from the CLI:

```sh
spec-brain cite feature/bookmark/BookmarkNavigation.kt 10 18
```

A minimal bundle has this shape:

```json
{
  "schemaVersion": 1,
  "repository": { "revision": "4aa482a" },
  "extractor": { "id": "codex", "version": "1", "model": "gpt-5", "promptVersion": "team-v1" },
  "filesRead": [{ "sourceId": "project", "path": "feature/bookmark/BookmarkNavigation.kt" }],
  "excluded": ["build outputs", "unconfigured product and design systems"],
  "profile": {
    "entries": [
      {
        "key": "navigation.style",
        "value": "typed routes",
        "citations": [
          {
            "sourceId": "project",
            "path": "...",
            "range": [1, 8],
            "contentHash": "sha256:...",
            "revision": "4aa482a"
          }
        ]
      }
    ]
  },
  "features": [
    {
      "key": "bookmark",
      "displayName": "Bookmark",
      "coverage": [
        {
          "section": "product",
          "status": "SOURCE_UNAVAILABLE",
          "reason": "No product source configured",
          "evidenceKeys": []
        },
        {
          "section": "design",
          "status": "SOURCE_UNAVAILABLE",
          "reason": "No design source configured",
          "evidenceKeys": []
        },
        { "section": "api", "status": "UNKNOWN", "reason": "API applicability not established", "evidenceKeys": [] },
        { "section": "implementation", "status": "ANALYZED", "evidenceKeys": ["bookmark-impl"] },
        { "section": "navigation", "status": "ANALYZED", "evidenceKeys": ["bookmark-route"] }
      ],
      "evidence": [
        {
          "key": "bookmark-route",
          "citation": {
            "sourceId": "project",
            "path": "...",
            "range": [10, 18],
            "contentHash": "sha256:...",
            "revision": "4aa482a"
          },
          "kind": "navigation-contract",
          "observation": { "direction": "incoming", "route": "MainTabRoute.Bookmark" },
          "confidence": 0.98,
          "authority": 0.8
        },
        {
          "key": "bookmark-impl",
          "citation": {
            "sourceId": "project",
            "path": "...",
            "range": [14, 21],
            "contentHash": "sha256:...",
            "revision": "4aa482a"
          },
          "kind": "implementation-behavior",
          "observation": { "summary": "Saved sessions are sorted by start time" },
          "confidence": 0.96,
          "authority": 0.8
        }
      ],
      "claims": [
        {
          "id": "bookmark-navigation",
          "predicate": "navigation",
          "object": { "direction": "incoming", "route": "MainTabRoute.Bookmark", "platform": "KMP" },
          "evidenceKeys": ["bookmark-route"]
        },
        {
          "id": "bookmark-implementation",
          "predicate": "implementation",
          "object": { "platform": "KMP", "status": "IMPLEMENTED", "location": "GetBookmarkedSessionsUseCase" },
          "evidenceKeys": ["bookmark-impl"]
        }
      ]
    }
  ]
}
```

## 3. Validate, review, and ingest

Validation is read-only and checks the entire proposal before any mutation:

```sh
spec-brain analysis validate --file project-analysis.json
```

Review feature discovery, files read, exclusions, coverage statuses, observations, and claims. Then a human applies the
bundle:

```sh
spec-brain analysis ingest --file project-analysis.json --confirm-human
```

Identical evidence remains idempotent. Submitting a different bundle always validates its actual citations; no scope
cache can return an older proposal. A repeated byte-equivalent bundle returns `UNCHANGED`.

## 4. Gate pull requests without changing them

```yaml
- run: spec-brain verify --check
```

The command is read-only. It exits 1 when evidence used by current claims or coverage is stale/orphaned, or when a
current claim needs review. It does not append an event, rewrite state, or dirty the checkout.

Use `spec-brain verify --write` only when the team intentionally wants to materialize the calculated state transitions
into a reviewable commit.

## 5. Resolve a real change

When code changes intentionally:

1. Let the AI refresh the affected feature, using Git changes and existing citations as its starting point.
2. Validate and review the new bundle.
3. Give changed claims new IDs and set `supersedes` to the prior claim ID.
4. Ingest the reviewed bundle.
5. Run `verify --check` again.

The old evidence remains historically stale, which is accurate, but it no longer blocks CI once only a superseded claim
depends on it. `INVALIDATED` is reserved for evidence that should never have been accepted; it is not required for
ordinary historical change.

## Pilot success criteria

A team pilot is successful only when a developer can complete this workflow without coaching, a real pull request
causes and resolves drift, `verify --check` leaves Git clean, coverage cannot hide unavailable sources, and reviewers
consider the generated file volume and review time acceptable.
