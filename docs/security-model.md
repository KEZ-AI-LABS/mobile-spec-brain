# Safety model

An external model may propose observations only. It cannot assert an unchecked fact: every observation carries a
citation, and `evidence record` rejects source-root escapes, missing ranges, and hash mismatches.

## Source-root containment

A citation path is resolved against its registered source root and rejected if it leaves that root, both lexically
(`..`) and after symbolic links are resolved with `realpath`. Extraction scopes are resolved the same way, and scope
hashing skips symbolic links entirely rather than following them out of the tree.

## Error messages do not echo cited content

A hash mismatch reports the citation, the expected hash, and the actual hash — never the bytes that were read. CLI
output reaches terminals, CI logs, and agent transcripts, so a message that quoted the cited lines would be a
disclosure path for any secret a mistaken citation happened to point at.

## Human gates

A profile stays `PROPOSED` until a reviewed edit sets it to `APPROVED`; evidence recording and extraction are blocked
before that point. Verification may mark evidence `STALE` or `ORPHANED`, but moving a record to `INVALIDATED`
requires `evidence invalidate --confirm-human`.

`--confirm-human` records intent, not identity. It makes invalidation a deliberate act with an audit event rather
than something an agent does in passing; it is not authentication, and the file protocol does not claim to be a
trust boundary against an operator who is already running the CLI.

## Extraction limits

A single extraction accepts at most 1000 observations. The cap is absolute rather than a ratio against existing
records, so a first extraction against an empty store is not rejected for lacking a baseline.
