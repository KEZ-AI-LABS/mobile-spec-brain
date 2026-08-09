# Spec resolution

`spec render <feature>` is a deterministic projection of committed claims, not an editable record. It selects the
claims for a feature, pulls the evidence they reference, and writes `spec/<feature>.spec.json` and
`spec/<feature>.md`.

## Projection

A claim reaches a typed section by the shape of its object, so no concept-specific recording command is needed:

| Object shape           | Section          |
| ---------------------- | ---------------- |
| `{ method, path }`     | `api`            |
| `{ nodeId, name }`     | `figma`          |
| `{ platform, status }` | `implementation` |
| `{ direction, route }` | `navigation`     |

A claim that matches nothing still appears in `claims`; the projection never invents a value it was not given.

## Sections

`--section <api|figma|implementation|navigation|unknowns>` narrows the render to one projection. The other
projections are emptied in both the JSON and the Markdown, while provenance — feature, completeness, graph hash,
claims, and evidence — is always retained so a narrowed view is still auditable.

## Completeness

Completeness is measured over claims: `knownFields` counts claims that are `ACTIVE` with all evidence `ACTIVE`, and
`unknownFields` is the remainder. A feature with no claims reports a single `EVIDENCE_ABSENT` unknown and a ratio of
zero. Missing product facts are reported as unknowns; they are never filled in.
