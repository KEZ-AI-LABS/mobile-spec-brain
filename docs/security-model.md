# Safety model

An external model may propose observations only. It cannot assert an unchecked fact: every observation carries a citation and `evidence record` rejects source-root escapes, missing ranges, and hash mismatches.

A profile remains `PROPOSED` until a human reviewed edit sets it to `APPROVED`; evidence recording is blocked before that point. Verification may make evidence stale or orphaned, but only a human actor may invalidate evidence. Dependent active claims are downgraded to `NEEDS_REVIEW`.

The retained ACL, mutation-policy, and circuit-breaker primitives are available to hosts that add orchestration. They do not grant an AI direct writes beyond this file protocol.
