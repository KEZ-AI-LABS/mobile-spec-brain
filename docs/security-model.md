# Safety model

An AI may propose one project analysis bundle. It cannot directly commit a fact: the CLI validates the complete bundle
and `analysis ingest` requires explicit human confirmation.

## Source containment and citations

Every citation is resolved against a registered source root and rejected if it escapes lexically or through symbolic
links. Every cited range is re-read and hashed. `filesRead` paths are also containment-checked, but they are audit
metadata rather than a permission or cache scope. Every cited path must be present in that manifest, preventing an AI
from understating which files supported its proposal.

Hash mismatch errors report citation coordinates and hashes but never echo cited source content, which may contain
secrets.

## Human gate

`analysis validate` is read-only. `analysis ingest --confirm-human` records reviewed intent, not authenticated identity.
It is an audit boundary for a local repository, not protection from an operator who can already edit files.

Low-level evidence invalidation also requires `--confirm-human`. Invalidation means the evidence should not have been
accepted; normal product evolution uses new evidence and superseding claims.

## Verification safety

`verify` and `verify --check` are read-only and never append an event. CI therefore cannot change the canonical store.
Only `verify --write` materializes calculated state changes, and a clean run writes nothing.

## Analysis limits

The CLI imposes no caller-selected code scope and no fixed observation-count cap. Agents may chunk large repositories
internally. Reviewability comes from explicit `filesRead`, `excluded`, feature coverage, deterministic citation
validation, and human approval of the final bundle.
