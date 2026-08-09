import { describe, expect, it } from "vitest";
import { buildSourceSpec, canRead, enforceSyncSafety, extractionCacheKey, InMemoryEventStore, planBlockSync, propagateDirty, renderSourceSpecMarkdown, resolveEvidence, validateMutation } from "./index.js";

describe("foundational primitives", () => {
  it("creates deterministic cache keys that change with extractor input", () => {
    const base = { contentHash: "a", extractorId: "api", extractorVersion: "1", schemaVersion: "1", promptVersion: "1", modelVersion: "m" };
    expect(extractionCacheKey(base)).toBe(extractionCacheKey(base));
    expect(extractionCacheKey(base)).not.toBe(extractionCacheKey({ ...base, extractorVersion: "2" }));
  });
  it("invalidates only descendants", () => {
    const nodes = propagateDirty(["raw:a"], [{ from: "raw:a", to: "evidence:a" }, { from: "evidence:a", to: "claim:a" }, { from: "raw:b", to: "evidence:b" }], (id) => id.split(":")[0]!.toUpperCase() as "RAW" | "EVIDENCE" | "CLAIM" | "RULE");
    expect(nodes.map((node) => node.id)).toEqual(["raw:a", "evidence:a", "claim:a"]);
  });
  it("keeps events append-only", async () => {
    const store = new InMemoryEventStore();
    await store.append({ id: "evt-1", occurredAt: new Date(), actor: "test", operation: "claim.propose", entityType: "claim", entityId: "claim:login", evidenceIds: [], reason: "test", payload: {} });
    expect(await store.list("claim:login")).toHaveLength(1);
  });
  it("plans block-level additions and does not reprocess unchanged blocks", () => {
    const block = { id: "block:login" as never, sourceEntityId: "entity:login" as never, revision: "r1", contentHash: "a".repeat(64), content: {}, metadata: {} };
    const first = planBlockSync("source:api" as never, "OPENAPI", "r1", { blocks: new Map() }, [block]);
    const second = planBlockSync("source:api" as never, "OPENAPI", "r1", { cursor: "r1", blocks: new Map([[block.id, block.contentHash]]) }, [block]);
    expect(first.changeSet.changes).toHaveLength(1); expect(second.changeSet.changes).toHaveLength(0);
  });
  it("preserves uncertainty when equal-authority evidence conflicts", () => {
    const evidence = (value: number, id: string) => ({ id: id as never, kind: "REQUIREMENT" as const, subject: "login.limit", predicate: "equals", value, extractionConfidence: 0.9, authority: 0.8, provenance: { sourceEntityId: "entity:a" as never, rawBlockId: "block:a" as never, revision: "1", extractorId: "test", extractorVersion: "1" } });
    expect(resolveEvidence([evidence(5, "evidence:a"), evidence(10, "evidence:b")]).state).toBe("UNKNOWN");
  });
  it("renders a byte-stable source spec and keeps unknowns explicit", () => {
    const input: Parameters<typeof buildSourceSpec>[0] = { feature: { key: "accounts", displayName: "Accounts", evidenceIds: ["evidence:api"] }, figmaFrames: [], api: [{ method: "GET", path: "/api/v1/accounts/{accountId}", normalizedPath: "/api/v1/accounts/{0}", deprecated: false, parameters: [{ name: "accountId", location: "path", required: true, schema: { type: "string" } }], requestBody: { status: "UNKNOWN", reason: "REQUEST_BODY_NOT_DECLARED" }, responses: { "200": { schema: { type: "object" } }, "404": { schema: { status: "UNKNOWN", reason: "SCHEMA_NOT_DECLARED" } } }, evidenceIds: ["evidence:api"], implementations: [{ platform: "android", status: "IMPLEMENTED", location: "android:AccountsApi.kt:12", evidenceIds: ["evidence:android"] }, { platform: "ios", status: "UNKNOWN", reason: "EVIDENCE_ABSENT", evidenceIds: [] }] }], navigation: { incoming: [], outgoing: [] }, unknowns: [{ field: "figmaFrames", reason: "EVIDENCE_ABSENT", evidenceIds: [] }], graphState: { claims: ["claim:one"] } };
    const first = buildSourceSpec(input); const second = buildSourceSpec(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(renderSourceSpecMarkdown(first)).toContain("EVIDENCE_ABSENT");
    expect(first.api[0]!.responses["200"]!.schema).toEqual({ type: "object" });
  });
  it("rejects generic or evidence-free mutations", () => {
    const policy = { allowedActors: ["reviewer"], minimumEvidence: 1 };
    expect(() => validateMutation({ id: "p1", operation: "claim.propose", actor: "reviewer", entityId: "claim:x", evidenceIds: [], reason: "test", payload: {} }, policy)).toThrow();
    expect(() => validateMutation({ id: "p2", operation: "database.execute", actor: "reviewer", entityId: "claim:x", evidenceIds: ["e1"], reason: "test", payload: {} }, policy)).toThrow();
  });
  it("opens a circuit breaker for unexpected sync scope", () => {
    expect(() => enforceSyncSafety({ changedEntities: 40, knownEntities: 100, invalidatedClaims: 1 }, { maxSourceChangeRatio: 0.3, maxClaimInvalidation: 500 })).toThrow("Circuit breaker");
  });
  it("does not allow source ACL escalation through derived records", () => {
    expect(canRead({ subject: "agent", grants: ["mobile"] }, ["mobile", "restricted"])).toBe(false);
  });
});
