# Sync engine

Adapters expose a normalized `SourceAdapter` contract. Each adapter returns a cursor and `ChangeSet`; core processing does not branch on Figma, Git, OpenAPI, or any future source type.

Block hashes are compared before extraction. A changed block invalidates only downstream evidence, specs, and rules reachable through dependency edges. The initial foundation provides deterministic dirty propagation and content-addressable extraction cache-key generation; source adapters will be added in the next vertical slices.
