# Archived: SpecWeave master build prompt

> **Historical document. Superseded — do not build from this.**
>
> This is the original generation prompt written under the project's first name
> (SpecWeave) and its first architecture: a SQLite-backed semantic graph with
> built-in source adapters. That design was replaced by the committed
> `.spec-brain/` file protocol described in [ADR-006](../decisions/ADR-006-open-semantic-graph.md)
> and [ADR-007](../decisions/ADR-007-no-derived-index.md). It is kept only to
> explain how the project got here.
>
> For the shipped design, read [architecture.md](../architecture.md).

---

SpecWeave — Master Build Prompt

You are a principal-level software architect and senior engineer responsible for designing and implementing a production-grade developer infrastructure project from scratch.

Your task is to build SpecWeave, an AI-native specification infrastructure for mobile product development.

Do not build this as a prototype, demo, or one-off script.

Design it as a maintainable, extensible system that could eventually be adopted by multiple engineering organizations with different workflows, repositories, tools, and development conventions.

⸻

1. Product Vision

Modern mobile product specifications are fragmented across many systems:

- Slack / Mattermost
- Confluence / Notion
- Figma
- Swagger / OpenAPI
- Android repositories
- iOS repositories
- GitHub / GitLab

These sources frequently become inconsistent.

Examples:

- Figma has a screen that Android implemented but iOS did not.
- Slack contains a recently approved policy change while Confluence still contains the previous specification.
- OpenAPI defines an error response that one mobile platform does not handle.
- Android and iOS implement different business rules.
- A specification was changed yesterday but only some implementations have propagated the change.
- Documentation, design, API, and implementation disagree about the current intended behavior.

SpecWeave continuously synchronizes these sources, extracts structured evidence, derives a machine-readable product specification, and detects specification drift.

The ultimate product should answer:

“Are product, design, API, Android, and iOS currently describing and implementing the same product?”

The system must also become reliable context infrastructure for AI coding agents.

AI agents should read the normalized specification rather than repeatedly searching all raw company data.

⸻

2. Fundamental Architecture Principle

Use the following conceptual pipeline:

External Sources

→ Sync Engine
→ Raw Store
→ Evidence Extraction
→ Evidence Graph
→ Entity Resolution
→ Decision Detection
→ Spec Resolution
→ Materialized Spec Graph / Spec Wiki
→ Rule Engine / AI Agents / MCP / CLI

The most important invariant is:

Synchronize evidence. Derive specifications.

Specifications must never become another manually maintained source of truth.

Raw source data and evidence are authoritative historical inputs.

Materialized specs and findings must always be rebuildable.

⸻

3. Trust Model

The architecture must follow these principles:

LLM is untrusted.
Evidence is immutable.
Mutations are constrained.

An LLM must never directly modify the specification database, Wiki, raw evidence, or internal files.

LLMs may only produce structured mutation proposals.

Actual mutations must pass through deterministic validation and policy enforcement.

The system should be safe even if:

- the LLM hallucinates,
- extraction results are incorrect,
- a source adapter returns unexpected data,
- a synchronization operation incorrectly reports thousands of changes,
- an agent attempts an unsupported mutation.

⸻

4. Human Interaction Model

Humans should not manually maintain the generated specification Wiki.

People continue working in their normal tools:

- designers work in Figma,
- PMs write documents,
- engineers write Android/iOS/backend code,
- teams discuss decisions in messaging systems.

SpecWeave observes those existing workflows.

The generated Spec Wiki is a read-only materialized representation.

Humans may:

- inspect specs,
- inspect evidence,
- approve or reject uncertain decisions,
- resolve conflicts,
- mark evidence as an authoritative decision,
- trigger synchronization.

Humans must not directly edit generated Spec records.

All changes go through the same constrained command layer used by AI agents.

⸻

5. Workspace Model

A company/project should configure sources once.

Do NOT require users to configure every individual feature.

Example:

project:
name: banking-mobile
sources:
android:
type: local
path: ../android
ios:
type: github
repo: company/ios
figma:
type: figma
files: - ABC123
openapi:
type: openapi
url: https://api.company.internal/openapi.json
docs: - type: confluence
space: MOBILE
messenger: - type: slack
channels: - mobile - product - design

Features should normally be discovered automatically.

Manual feature configuration exists only as an override / escape hatch.

⸻

6. Feature Discovery

Do not make feature registration mandatory.

The system should discover feature candidates from source structure.

Examples:

Android:

feature/login
feature/account
feature/transfer

iOS:

Features/Login
Features/Account
Features/Transfer

Figma:

Login
Login / Error
Login / Locked

API:

/auth/login
/auth/logout

Documents:

로그인 정책
계좌 개설
송금

Messaging:

#login-renewal
#transfer-project

Entity resolution should connect these to stable feature identities.

Example:

계좌개설
account-opening
AccountOpening
accountOpening

may resolve to:

feature:account-opening

Feature configuration should only be needed when automatic resolution is ambiguous.

⸻

7. Stable Identity

Text must never be treated as identity.

A specification renamed from:

로그인 실패 제한

to:

로그인 실패 시 계정 보호 정책

must not automatically become a new specification.

Implement stable identifiers for:

- sources,
- source entities,
- raw blocks,
- evidence,
- specs,
- features,
- decisions,
- findings.

Entity resolution must distinguish:

existing entity modified

from:

new entity created

This is one of the most important systems in SpecWeave.

⸻

8. Incremental Sync Engine

The system must support efficient incremental synchronization.

Never reprocess the complete workspace unless explicitly rebuilding.

Each adapter should use the best cursor mechanism available for its source.

Examples:

Git → commit SHA
Slack → timestamp / cursor
Confluence → page version
Notion → last_edited_time
Figma → version / lastModified
OpenAPI → content hash

Normalize source changes into:

interface ChangeSet {
source: SourceType
cursor: string
changes: Change[]
}
type Change =
| AddedChange
| ModifiedChange
| DeletedChange

Core sync logic should not care whether the source is Figma, Git, Slack, or Confluence.

⸻

9. Block-Level Incremental Processing

File-level invalidation alone is insufficient.

Large source entities must be decomposed into stable logical blocks.

Examples:

- Confluence headings/blocks
- Notion blocks
- Figma nodes
- OpenAPI operations and schemas
- Kotlin/Swift symbols or semantic units
- Slack messages / threads

Each block must have:

- stable identity when possible,
- content hash,
- parent source identity,
- source revision,
- metadata.

Only changed blocks should be reprocessed.

Example:

Block A hash unchanged
Block B hash unchanged
Block C changed
Block D unchanged
→ extract Block C only

⸻

10. Content Addressable Extraction Cache

LLM calls and expensive analysis must be cached.

Use a deterministic cache key based on values such as:

raw content hash
extractor id
extractor version
schema version
prompt version
model identifier

Conceptually:

cacheKey = hash(
contentHash +
extractorVersion +
schemaVersion +
promptVersion +
modelVersion
)

Identical input processed by an identical extractor should never require another LLM call.

⸻

11. Raw Store

Raw source data must preserve historical revisions.

Do not overwrite history.

Model:

interface RawRevision {
id: string
sourceEntityId: string
revision: string
contentHash: string
content: unknown
fetchedAt: Date
sourceUpdatedAt?: Date
metadata: Record<string, unknown>
}

Source deletion does not delete historical data.

Instead use states such as:

ACTIVE
DELETED_AT_SOURCE

⸻

12. Evidence Layer

Do NOT derive the final Spec directly from raw content.

First extract structured facts/evidence.

Example source statement:

로그인 재시도 횟수를 10회에서 5회로 변경합니다.

Possible evidence:

{
"subject": "login.retryLimit",
"predicate": "equals",
"value": 5,
"confidence": 0.97
}

Evidence must retain provenance.

Example:

{
"sourceEntity": "slack:message:12345",
"revision": "1739182",
"range": "...",
"extractorVersion": "business-rule:v3"
}

⸻

13. Evidence Types

Do not treat every piece of text equally.

Distinguish evidence semantics such as:

OBSERVATION
DISCUSSION
QUESTION
PROPOSAL
DECISION
REQUIREMENT
DESIGN
API_CONTRACT
IMPLEMENTATION

A Slack discussion is not automatically a specification.

Example:

A: 5회로 바꿀까요?
B: 괜찮은 것 같아요.

must not automatically become an approved requirement.

But:

PO: 서버 검토 완료했고 5회로 적용하는 것으로 확정합니다.

may become a strong Decision candidate.

Decision detection must therefore exist as an explicit system.

⸻

14. Authority Model

Confidence and authority must be different concepts.

Example:

A Slack message might be extracted with:

extraction confidence = 0.99

but still have:

authority = low

An approved product policy might have:

authority = high

while extraction confidence could be lower because its wording is ambiguous.

Support dimensions such as:

extractionConfidence
authority
freshness

Authority policies must be configurable by company profile and specification domain.

Example:

authority:
business_rule:
precedence: - approved_decision - product_document - design - messenger - implementation
api_contract:
precedence: - openapi - backend_code - mobile_code
ui:
precedence: - figma - product_document - mobile_code

Do NOT hardcode one universal hierarchy.

⸻

15. Spec Resolution

Specs are materialized views derived from evidence.

Example:

login.retryLimit
Slack 5
Confluence 10
Android 5
iOS 5

Spec Resolution should determine:

- current likely specification,
- supporting evidence,
- conflicting evidence,
- confidence,
- authority,
- freshness,
- validity,
- lifecycle.

It must be able to return UNKNOWN rather than making an unjustified decision.

Never force certainty.

⸻

16. Temporal Validity

Specifications are time/version dependent.

Support:

environment
platform
app version
effective date
release

Example:

validity:
environment: - production
platforms: - android - ios
appVersion:
from: 8.23.0
effectiveAt: 2026-08-20

Two different specifications can both be correct if they apply to different versions or environments.

The validation engine must understand this.

⸻

17. Spec Lifecycle

Support lifecycle states similar to:

PROPOSED
APPROVED
IMPLEMENTING
RELEASED
DEPRECATED
REMOVED

Implementation checks must understand lifecycle.

A feature that is approved but intentionally not implemented yet must not automatically produce a critical missing implementation error.

⸻

18. Provenance

Every final spec value must be explainable.

Conceptually every field is:

value + provenance

A query such as:

Why is login.retryLimit currently 5?

should produce something like:

Current value: 5
Evidence:

- approved Slack decision on Aug 8
- Figma updated on Aug 8
- Android implementation = 5
- older Confluence document still says 10
  Confidence: High

Never generate a specification that cannot be traced back to evidence.

⸻

19. Materialized Spec Wiki

Produce two representations from the same Spec Graph.

Human representation:

Feature
Overview
Business Rules
Screens
States
Navigation
APIs
Error Handling
Analytics
Platform Status
Known Conflicts
Recent Changes
Evidence

Machine representation:

{
"feature": "...",
"requirements": [],
"screens": [],
"states": [],
"navigation": [],
"apis": [],
"analytics": [],
"relationships": []
}

The Human Wiki must not be an independently editable database.

It is a renderer over the Spec Graph.

⸻

20. Dependency Graph

Maintain dependency edges:

Raw Block
↓ produces
Evidence
↓ contributes_to
Spec
↓ belongs_to
Feature
↓ evaluated_by
Rule
↓ creates
Finding

This graph enables incremental invalidation.

When one source changes:

changed Raw block
→ dirty Evidence
→ dirty Specs
→ affected Features
→ affected Rules

Only impacted nodes must be recalculated.

⸻

21. Dirty Propagation

Implement explicit dirty/invalidation semantics.

Possible dirty entities:

DirtyRaw
DirtyEvidence
DirtySpec
DirtyRule

Do not execute full recomputation after every change.

⸻

22. Findings

Differentiate different forms of inconsistency.

At minimum:

CONFLICT
IMPLEMENTATION_DRIFT
DOCUMENTATION_DRIFT
PENDING_PROPAGATION
MISSING_IMPLEMENTATION
MISSING_API
UNKNOWN

Do not treat every mismatch as an error.

Example:

Spec: 5
Android: 5
iOS: 10
iOS target release: upcoming version

may be:

PENDING_PROPAGATION

rather than:

MISSING_IMPLEMENTATION

⸻

23. Static Analysis vs Semantic Analysis

Do not use an LLM for things deterministic analysis can prove.

Deterministic analysis should handle where possible:

Android:

- Kotlin symbols
- Compose screens
- XML resources
- Navigation
- Retrofit APIs
- Manifest permissions
- deep links
- analytics
- feature flags

iOS:

- Swift symbols
- SwiftUI views
- UIKit screens
- NavigationStack / Coordinator
- networking layer
- Info.plist
- deep links
- analytics
- feature flags

API:

- OpenAPI operations
- request/response schemas
- status/error codes

Use AST/tree-sitter/compiler APIs where appropriate.

Recommended principle:

Deterministic analyzers identify evidence.
LLMs resolve semantics.

Not:

Send repository to LLM and ask whether feature exists.

⸻

24. Rules Engine

Rules must be plugin-based and configurable.

Generic rules may include:

Screen parity
API parity
Navigation parity
Deep link parity
Permission parity
Analytics parity
Error handling parity
Business rule consistency

Company-specific rules may include:

Design System compliance
Analytics naming conventions
Security policy
Architecture conventions
Feature flag requirements

Do not hardcode company behavior into core logic.

⸻

25. Company Profiles

Provide profiles that extend generic behavior.

Examples:

mobile-generic
android-compose
android-xml
ios-swiftui
ios-uikit
server-driven-ui

Example project profile:

extends:

- mobile-generic
- android-compose
- ios-swiftui
  featureDetection:
  android:
  patterns:
  - feature/{feature}
  - domain/{feature}
    ios:
    patterns:
  - Features/{feature}

Core logic must remain company-independent.

⸻

26. Mutation Architecture

AI must not receive generic write access.

Do NOT expose capabilities such as:

database.execute
wiki.edit
spec.write
file.write

Instead expose narrow semantic commands.

Examples:

spec.propose
spec.supersede
spec.deprecate
spec.setValidity
evidence.link
evidence.invalidate
decision.mark
conflict.resolve

All mutations must:

1. create a proposal,
2. pass schema validation,
3. verify evidence,
4. verify ACL,
5. verify authority policy,
6. verify temporal constraints,
7. verify safety thresholds,
8. execute transaction,
9. append event log.

No evidence, no mutation.

⸻

27. No Hard Delete

Do not expose delete operations for specs or evidence.

Use:

SUPERSEDED
DEPRECATED
INVALIDATED
DELETED_AT_SOURCE

Preserve history.

Rollback must be implemented as a new event, not state rewrites.

⸻

28. Event Store

Every mutation must produce an append-only event.

Store:

actor
timestamp
operation
entity
old state
new state
evidence references
reason
model identifier
skill version
extractor version

Support:

audit
history
replay
rollback
debug

⸻

29. Safety for Large Syncs

sync all must not blindly apply all changes.

Internally use:

PLAN
→ DIFF
→ APPLY

Support safety thresholds such as:

safety:
maxSpecInvalidation: 500
maxSourceChangeRatio: 0.30

Unexpectedly large invalidations should trigger a circuit breaker.

⸻

30. Security

Treat enterprise security as a core architectural concern.

Support:

Source ACL
↓
Evidence ACL
↓
Spec ACL
↓
LLM Context ACL

Information that a user cannot access at the source must not become indirectly accessible through the generated Spec Wiki.

Prevent permission escalation through derived information.

Also support future policies such as:

local model only
private model endpoint
external LLM allowed

Secrets and sensitive values should be redacted before external LLM processing where required.

⸻

31. Skills / Tool Interface

Design the internal application API so it can later be exposed through:

- CLI
- MCP
- GitHub Actions
- GitLab CI
- Web UI
- IDE plugins
- AI agents

Recommended semantic operations:

READ

spec.get
spec.search
feature.get
feature.list
evidence.get
history.get
changes.get

SYNC

sync.status
sync.source
sync.changed
sync.all
sync.plan

MUTATION

spec.propose
spec.supersede
spec.deprecate
spec.setValidity
evidence.link
evidence.invalidate
decision.mark
conflict.resolve

VALIDATION

validate.spec
validate.feature
validate.changed
validate.project

ADMIN

rebuild.spec
rebuild.index
event.replay
event.revert
health.check

Do not expose low-level unrestricted mutation APIs.

⸻

32. Initial CLI

Provide a high-quality CLI.

Examples:

specweave init
specweave sync
specweave sync --plan
specweave check
specweave check --changed
specweave feature login
specweave spec LOGIN-001
specweave evidence LOGIN-001
specweave history LOGIN-001
specweave doctor

CLI output should be clear, deterministic, and automation friendly.

Every human-readable output should also support JSON where appropriate:

specweave check --json

⸻

33. Initial Source Scope

Architect for all future adapters:

Slack
Mattermost
Confluence
Notion
Figma
OpenAPI
GitHub
GitLab
Android
iOS

But do NOT attempt to fully implement everything before proving the architecture.

The first complete vertical slice should use:

Figma
OpenAPI
Android local/Git repository
iOS local/Git repository

The architecture must already allow additional adapters without changing Core.

⸻

34. First Validation Capabilities

Initial end-to-end validation should focus on:

1. Screen parity

Figma
↕
Android
↕
iOS

2. API parity

OpenAPI
↕
Android
↕
iOS

3. Navigation parity

Figma prototype / spec
↕
Android navigation
↕
iOS navigation

Do these well before implementing dozens of shallow checks.

⸻

35. Recommended Repository Structure

Use a monorepo.

Recommended shape:

specweave/
apps/
cli/
mcp/
packages/
core/
graph/
entities/
specs/
evidence/
decisions/
resolution/
findings/
events/
sync/
engine/
cursors/
diff/
invalidation/
adapters/
figma/
openapi/
slack/
mattermost/
confluence/
notion/
github/
gitlab/
analyzers/
android/
ios/
rules/
screen-parity/
api-parity/
navigation-parity/
profiles/
mobile-generic/
android-compose/
android-xml/
ios-swiftui/
ios-uikit/
policy/
acl/
authority/
mutation/
safety/
storage/
sdk/
testing/

Adjust this structure if implementation evidence justifies a better decomposition, but preserve the architectural boundaries.

⸻

36. Technology Direction

Prefer TypeScript for the orchestration layer and CLI unless strong technical evidence suggests otherwise.

Candidate stack:

TypeScript
Node.js
pnpm workspace
SQLite initially
Drizzle ORM or equivalent
Zod for runtime schemas
tree-sitter where useful
Git CLI / native libraries
MCP SDK
Vitest

Avoid unnecessary infrastructure.

Do NOT introduce Kafka, Kubernetes, Neo4j, Redis, or distributed architecture for the initial implementation unless they solve a demonstrated requirement.

The system should initially work well on one developer machine.

Maintain clean abstractions so SQLite can later move to PostgreSQL or another backend.

⸻

37. Storage Model

Plan for entities approximately equivalent to:

workspaces
sources
source_entities
raw_revisions
raw_blocks
evidence
decisions
features
specs
spec_revisions
edges
findings
sync_cursors
extractor_cache
events
policies

Use schema migrations from the beginning.

⸻

38. Observability

Build observability into the architecture.

Track:

sync duration
source fetch count
changed entities
changed blocks
cache hit rate
LLM extraction count
dirty specs
affected features
rules evaluated
findings created/resolved

Expose useful diagnostics through:

specweave doctor

Do not log source secrets or sensitive raw content unnecessarily.

⸻

39. Testing Strategy

This system depends heavily on correctness.

Use:

Unit tests

For:

- hash comparison,
- cursor handling,
- entity resolution,
- dependency propagation,
- authority rules,
- lifecycle rules,
- mutation validation.

Golden tests

Given fixed source snapshots, derived evidence/spec output should remain stable.

Adapter contract tests

Every adapter must satisfy the same SourceAdapter contract.

Integration tests

Example:

Figma node changes
→ ChangeSet
→ Raw block invalidation
→ new evidence
→ affected Spec updated
→ parity rule executes
→ Finding generated

Failure tests

Explicitly test:

- deleted evidence,
- stale cursor,
- conflicting authority,
- malformed LLM output,
- duplicate entities,
- source rate limits,
- partial sync failure,
- excessive invalidation,
- interrupted transaction.

⸻

40. Documentation

Treat architecture documentation as part of the implementation.

Create at least:

README.md
docs/architecture.md
docs/data-model.md
docs/sync-engine.md
docs/spec-resolution.md
docs/security-model.md
docs/plugin-authoring.md
docs/decisions/

Use lightweight ADRs for major architectural decisions.

Examples:

ADR-001 Evidence before Spec
ADR-002 Append-only mutation history
ADR-003 LLM treated as untrusted
ADR-004 Materialized Spec Wiki
ADR-005 Incremental dependency invalidation

⸻

41. Engineering Quality Requirements

Avoid:

- god objects,
- circular dependencies,
- global mutable state,
- hidden implicit conventions,
- untyped LLM output,
- direct DB mutations outside repositories/transactions,
- source-specific logic inside Core,
- business logic inside CLI commands,
- silent error swallowing.

Prefer:

- explicit domain models,
- dependency inversion,
- small interfaces,
- deterministic transforms,
- schema-validated boundaries,
- pure functions where possible,
- structured errors,
- reproducible tests.

⸻

42. Development Strategy

Do not attempt to build the entire future platform simultaneously.

Build one real vertical slice first.

Recommended sequence:

Phase 1 — Foundation

monorepo
domain model
storage
events
source adapter interface
sync cursor
ChangeSet
raw revision/block storage

Phase 2 — First Sources

OpenAPI adapter
Git/local repository adapter
basic Android analyzer
basic iOS analyzer

Phase 3 — Evidence

API evidence extraction
screen evidence extraction
navigation evidence extraction
provenance

Phase 4 — Graph

features
specs
edges
dirty propagation
incremental recomputation

Phase 5 — Validation

API parity
screen parity
navigation parity
findings

Phase 6 — Figma

Figma adapter
screen nodes
prototype/navigation evidence

Phase 7 — Agent Interface

MCP server
spec.get
feature.get
evidence.get
validate.feature

Phase 8 — Semantic Resolution

Only after deterministic infrastructure works:

LLM extractor interface
Decision detection
semantic entity resolution
Spec Resolution
content-addressable cache

Do not introduce LLM complexity before deterministic foundations are functional.

⸻

43. Definition of First Complete Milestone

The first meaningful release is complete when a developer can:

specweave init

configure:

OpenAPI
Android repository
iOS repository
Figma

then execute:

specweave sync
specweave check

and receive evidence-backed findings such as:

TRANSFER-API-003
Type
IMPLEMENTATION_DRIFT
Specification
POST /transfer may return TRANSFER_LIMIT_EXCEEDED.
OpenAPI
✓ documented
Android
✓ handled
iOS
✕ implementation evidence not found
Evidence
openapi:/transfer#422
android:TransferRepository.kt:183
Confidence
High

The user must be able to inspect why the result exists.

⸻

44. Important Behavioral Rule

Never report:

NOT_IMPLEMENTED

just because implementation was not found.

Use:

UNKNOWN

when there is insufficient evidence.

A strong negative finding requires deterministic or sufficiently strong evidence.

False positives will destroy trust in this product.

Trustworthiness is more important than finding quantity.

⸻

45. Agent Working Instructions

Before implementing:

1. Read this entire specification.
2. Produce an architecture plan.
3. Identify risky assumptions.
4. Establish domain boundaries.
5. Create ADRs for foundational decisions.
6. Define the initial database schema.
7. Define SourceAdapter and ChangeSet contracts.
8. Define Spec/Evidence/Event core models.
9. Define the first vertical slice.
10. Then begin implementation.

Do not repeatedly ask the user for minor implementation decisions.

Make strong, well-reasoned engineering choices and document them.

When encountering ambiguity:

- prefer maintainability,
- prefer deterministic behavior,
- prefer evidence preservation,
- prefer extensibility through interfaces rather than speculative complexity.

After each meaningful milestone:

- run tests,
- run type checking,
- run linting,
- update architecture documentation,
- inspect for architectural drift.

Do not leave placeholder implementations marked as complete.

⸻

46. Core Product Principles

Keep these principles visible throughout implementation:

1. Evidence before interpretation

Never lose the original evidence behind a derived specification.

2. Derived specs, not manually maintained specs

Spec Wiki is a materialized view.

3. Incremental by default

Only recompute what changed.

4. LLM is not trusted infrastructure

LLMs propose. Deterministic systems commit.

5. Unknown is a valid answer

Do not manufacture certainty.

6. Convention over configuration

Automatically discover normal structures.

7. Configuration over hardcoding

Organizations can override conventions.

8. No evidence, no mutation

Every change must be explainable.

9. Append history, never destroy it

Auditing and replay must always remain possible.

10. AI agents consume SpecWeave, not raw organizational chaos

The ultimate role of SpecWeave is to become reliable context infrastructure for software agents.

⸻

47. Start Now

Begin by creating the initial project architecture.

First deliver:

1. repository structure,
2. architecture document,
3. ADRs,
4. core domain types,
5. SQLite schema,
6. migration setup,
7. event store foundation,
8. SourceAdapter contract,
9. ChangeSet model,
10. incremental Sync Engine skeleton,
11. tests for all foundational primitives,
12. functional CLI shell containing:

specweave init
specweave sync
specweave sync --plan
specweave check
specweave doctor

Do not fake unsupported functionality.

Commands that are not implemented yet must clearly report that they are unavailable.

Once the foundation is healthy, proceed to the first real vertical slice rather than generating broad placeholder code.

The final system should optimize for long-term correctness, explainability, incremental operation, and enterprise extensibility.
