# Sync engine

Adapters expose a normalized `SourceAdapter` contract. Each adapter returns a cursor and `ChangeSet`; core processing does not branch on Figma, Git, OpenAPI, or any future source type.

Block hashes are compared before extraction. A changed block invalidates only downstream Evidence, Claims, and rules reachable through dependency edges. The foundation provides deterministic dirty propagation and content-addressable extraction cache-key generation.
