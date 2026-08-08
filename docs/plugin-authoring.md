# Plugin authoring

Source adapters and rules are plugins around core contracts. An adapter must provide stable source/entity/block identities where possible, return deterministic cursors, and pass contract tests. A rule consumes Evidence and semantic-graph inputs and emits evidence-backed findings; it must not mutate records directly.
