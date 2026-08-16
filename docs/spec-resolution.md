# Spec resolution

`spec render <feature>` is a deterministic projection of current claims, effective evidence state, and the feature's
fixed coverage record. It writes generated JSON and Markdown under `.spec-brain/spec/`.

## Projection

| Claim object shape     | Projection       |
| ---------------------- | ---------------- |
| `{ method, path }`     | `api`            |
| `{ nodeId, name }`     | `figma`          |
| `{ platform, status }` | `implementation` |
| `{ direction, route }` | `navigation`     |

Open-world claims that match no projection remain in provenance. Superseded claims are historical and are excluded
from the current materialized view.

## Completeness

Completeness is based on the five protocol sections: product, design, API, implementation, and navigation.
`ANALYZED` and `NOT_APPLICABLE` count as complete while `UNKNOWN` and `SOURCE_UNAVAILABLE` remain incomplete. A section
whose evidence is stale becomes `NEEDS_REVIEW` and incomplete. Claim count cannot inflate the result.

`--section <api|figma|implementation|navigation|unknowns>` narrows typed projections while retaining protocol coverage,
current provenance, graph hash, claims, and evidence.
