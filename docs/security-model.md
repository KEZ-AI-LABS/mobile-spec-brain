# Security model

Source ACLs must flow to evidence, specs, and LLM context. A user who cannot read source data must not gain derived access through Mobile Spec Brain. Sensitive source payloads must be redacted before any permitted external model call.

No LLM receives database, filesystem, wiki-edit, or unrestricted mutation access. It can only submit structured proposals to a policy-checked command layer.
