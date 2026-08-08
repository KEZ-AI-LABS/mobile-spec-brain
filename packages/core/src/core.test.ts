import { describe, expect, it } from "vitest";
import { canRead, enforceSyncSafety, extractionCacheKey, InMemoryEventStore, materializeApiSpecs, planBlockSync, propagateDirty, resolveEvidence, validateMutation } from "./index.js";

describe("foundational primitives", () => {
  it("creates deterministic cache keys that change with extractor input", () => {
    const base = { contentHash: "a", extractorId: "api", extractorVersion: "1", schemaVersion: "1", promptVersion: "1", modelVersion: "m" };
    expect(extractionCacheKey(base)).toBe(extractionCacheKey(base));
    expect(extractionCacheKey(base)).not.toBe(extractionCacheKey({ ...base, extractorVersion: "2" }));
  });
  it("invalidates only descendants", () => {
    const nodes = propagateDirty(["raw:a"], [{ from: "raw:a", to: "evidence:a" }, { from: "evidence:a", to: "spec:a" }, { from: "raw:b", to: "evidence:b" }], (id) => id.split(":")[0]!.toUpperCase() as "RAW" | "EVIDENCE" | "SPEC" | "RULE");
    expect(nodes.map((node) => node.id)).toEqual(["raw:a", "evidence:a", "spec:a"]);
  });
  it("keeps events append-only", async () => {
    const store = new InMemoryEventStore();
    await store.append({ id: "evt-1", occurredAt: new Date(), actor: "test", operation: "spec.propose", entityType: "spec", entityId: "spec:login", evidenceIds: [], reason: "test", payload: {} });
    expect(await store.list("spec:login")).toHaveLength(1);
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
  it("discovers a feature from deterministic API evidence", () => {
    const result = materializeApiSpecs([{ id: "evidence:transfer" as never, kind: "API_CONTRACT", subject: "api.POST./transfer", predicate: "defines", value: { method: "POST", path: "/transfer" }, extractionConfidence: 1, authority: 1, provenance: { sourceEntityId: "entity:api" as never, rawBlockId: "block:api" as never, revision: "1", extractorId: "test", extractorVersion: "1" } }]);
    expect(result).toMatchObject([{ featureKey: "transfer", key: "api.post./transfer" }]);
  });
  it("rejects generic or evidence-free mutations", () => {
    const policy = { allowedActors: ["reviewer"], minimumEvidence: 1 };
    expect(() => validateMutation({ id: "p1", operation: "spec.propose", actor: "reviewer", entityId: "spec:x", evidenceIds: [], reason: "test", payload: {} }, policy)).toThrow();
    expect(() => validateMutation({ id: "p2", operation: "database.execute", actor: "reviewer", entityId: "spec:x", evidenceIds: ["e1"], reason: "test", payload: {} }, policy)).toThrow();
  });
  it("opens a circuit breaker for unexpected sync scope", () => {
    expect(() => enforceSyncSafety({ changedEntities: 40, knownEntities: 100, invalidatedSpecs: 1 }, { maxSourceChangeRatio: 0.3, maxSpecInvalidation: 500 })).toThrow("Circuit breaker");
  });
  it("does not allow source ACL escalation through derived records", () => {
    expect(canRead({ subject: "agent", grants: ["mobile"] }, ["mobile", "restricted"])).toBe(false);
  });
});
