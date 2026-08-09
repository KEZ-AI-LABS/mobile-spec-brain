# Data model

Citation is closed: `sourceId`, `path`, inclusive line `range`, SHA-256 `contentHash`, and `revision` are required.
The verifier re-reads exactly that range under the registered source root.

Everything semantic is open: evidence `kind`, observation fields, claim predicate/object, and discovered concepts are
strings or JSON values rather than a mobile-domain enum.

## Evidence

An evidence ID is `ev_<sha256>` over `{ citation, kind, observation }`. Distinct observations about the same lines are
distinct records; an identical observation recorded twice is one record. States are `ACTIVE`, `STALE`, `ORPHANED`, and
`INVALIDATED`.

## Claims

A claim references existing evidence IDs and starts `ACTIVE`. It becomes `NEEDS_REVIEW` when any evidence it depends
on stops being `ACTIVE`, and `SUPERSEDED` when a later claim declares `supersedes`. Claim files are never rewritten in
place except to record those state transitions.

## Serialization

All JSON uses recursively sorted keys and two-space indentation, written atomically through a temporary file. A single
record lives in a single evidence or claim file, so ordinary Git diffs remain reviewable and byte-stable across runs.
