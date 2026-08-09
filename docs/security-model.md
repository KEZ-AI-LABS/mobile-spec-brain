# Security model

Source ACLs must flow to Evidence, graph records, generated views, and LLM context. A user who cannot read source data must not gain derived access through Mobile Spec Brain. Sensitive source payloads must be redacted before any permitted external model call.

No LLM receives database, filesystem, wiki-edit, or unrestricted mutation access. It can only submit evidence-backed structured proposals to a policy-checked command layer. Free-form interpretation is allowed only before this boundary; persistence requires valid identifiers, permitted operation types, and existing evidence references.
