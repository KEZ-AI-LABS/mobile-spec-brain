# Data model

Citation is closed: `sourceId`, `path`, inclusive line `range`, SHA-256 `contentHash`, and `revision` are required. The verifier re-reads exactly that range under the registered source root.

Everything semantic is open: evidence `kind`, observation fields, claim predicate/object, and discovered concepts are strings or JSON values rather than a mobile-domain enum. A claim references existing `ev_<citation-hash>` records and starts `ACTIVE`; it can become `NEEDS_REVIEW` when dependent evidence is `STALE`, `ORPHANED`, or human-invalidated.

All JSON uses sorted keys and two-space indentation. A single record lives in a single evidence or claim file, so ordinary Git diffs remain reviewable.
