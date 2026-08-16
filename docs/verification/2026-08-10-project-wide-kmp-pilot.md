# Project-wide KMP pilot — 2026-08-10

## Target and isolation

- Target: a disposable local clone of `DroidKnightsApp-KMP` at revision `4aa482a`.
- Feature: bookmark navigation and bookmarked-session ordering.
- The developer's original checkout was not modified.
- Product and design systems were intentionally unavailable in this local pilot.

## Initial analysis

The project-wide bundle recorded three files read, one discovered feature, two cited evidence records, two claims, and
all five protocol coverage sections. `analysis validate` and human-confirmed `analysis ingest` succeeded.

Rendered coverage was:

| Section        | Declared status    | Effective state |
| -------------- | ------------------ | --------------- |
| product        | SOURCE_UNAVAILABLE | INCOMPLETE      |
| design         | SOURCE_UNAVAILABLE | INCOMPLETE      |
| api            | UNKNOWN            | INCOMPLETE      |
| implementation | ANALYZED           | COMPLETE        |
| navigation     | ANALYZED           | COMPLETE        |

Completeness was 40%, not 100%. `verify --check` exited 0 with zero changes. After committing the pilot baseline, a
second clean check left both the event count and Git status unchanged.

## Drift and resolution

The implementation changed session ordering from ascending to descending. A read-only `verify --check` then:

- exited 1;
- reported the implementation evidence as current stale evidence;
- reported `bookmark-implementation` as needing review;
- reported two calculated transitions;
- appended no event and changed no `.spec-brain` file.

A second project analysis cited the changed range, proposed `bookmark-implementation-v2`, and superseded
`bookmark-implementation`. After validation and human-confirmed ingestion, `verify --check` exited 0. The prior
evidence remained under `historicalStale`; it no longer blocked current CI. The current rendered spec contained only
the replacement implementation claim and retained 40% protocol completeness.

## Proven gates

- No caller-provided extraction scope.
- Every different proposal was citation-validated.
- Fixed-section completeness exposed unavailable sources.
- CI verification was read-only.
- Ordinary product evolution used supersession, not false invalidation of previously valid evidence.
- Historical stale evidence remained auditable without blocking current claims.
