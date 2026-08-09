import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySourceSync, commitProposal, materializeSemanticGraph, persistEvidence, persistFindings, SqliteEventStore, openWorkspaceDatabase } from "./index.js";

describe("SQLite storage", () => {
  it("migrates and persists append-only events", async () => {
    const database = openWorkspaceDatabase(join(mkdtempSync(join(tmpdir(), "mobile-spec-brain-")), "workspace.sqlite"));
    const store = new SqliteEventStore(database);
    await store.append({ id: "evt-1", occurredAt: new Date("2026-01-01T00:00:00Z"), actor: "test", operation: "sync.apply", entityType: "source", entityId: "source:api", evidenceIds: [], reason: "test", payload: {} });
    expect(await store.list("source:api")).toHaveLength(1);
    expect(database.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([{ version: "001_semantic_graph" }]);
    database.close();
  });
  it("atomically records raw blocks, cursor, and sync event", () => {
    const database = openWorkspaceDatabase(join(mkdtempSync(join(tmpdir(), "mobile-spec-brain-")), "workspace.sqlite"));
    database.prepare("INSERT INTO workspaces (id, name, created_at) VALUES ('workspace:test', 'test', '2026-01-01')").run();
    const hash = "a".repeat(64); const now = new Date("2026-01-01T00:00:00Z");
    applySourceSync(database, { actor: "test", source: { id: "source:api", type: "OPENAPI", displayName: "API", configuration: {} }, changeSet: { sourceId: "source:api" as never, sourceType: "OPENAPI", cursor: hash, changes: [{ kind: "ADDED", entityId: "entity:api" as never, revision: hash }], fetchedAt: now }, blocks: [{ id: "block:api" as never, sourceEntityId: "entity:api" as never, revision: hash, contentHash: hash, content: { path: "/transfer" }, metadata: {} }] });
    expect(database.prepare("SELECT cursor FROM sync_cursors").all()).toEqual([{ cursor: hash }]);
    expect(database.prepare("SELECT external_id FROM raw_blocks").all()).toEqual([{ external_id: "block:api" }]);
    persistEvidence(database, [{ id: "evidence:api" as never, kind: "API_CONTRACT", subject: "api.POST./transfer", predicate: "defines", value: {}, extractionConfidence: 1, authority: 1, provenance: { sourceEntityId: "entity:api" as never, rawBlockId: "block:api" as never, revision: hash, extractorId: "test", extractorVersion: "1" } }]);
    expect(database.prepare("SELECT subject FROM evidence").all()).toEqual([{ subject: "api.POST./transfer" }]);
    materializeSemanticGraph(database, { entities: [{ id: "entity:feature:transfer", type: "feature", attributes: {}, evidenceIds: ["evidence:api"] }, { id: "entity:api:POST:/transfer", type: "api_operation", attributes: {}, evidenceIds: ["evidence:api"] }], claims: [{ id: "claim:transfer-api", subjectId: "entity:feature:transfer", predicate: "exposes_api", object: { entityId: "entity:api:POST:/transfer" }, qualifiers: {}, confidence: 1, authority: 1, evidenceIds: ["evidence:api"] }], relations: [{ id: "relation:transfer-api", fromId: "entity:feature:transfer", type: "exposes_api", toId: "entity:api:POST:/transfer", evidenceIds: ["evidence:api"] }], discoveredConcepts: [{ kind: "ENTITY_TYPE", name: "eligibility_policy" }, { kind: "PREDICATE", name: "requires_identity_verification" }] }, "test");
    expect(database.prepare("SELECT type FROM semantic_entities ORDER BY type").all()).toEqual([{ type: "api_operation" }, { type: "feature" }]);
    expect(database.prepare("SELECT entity_id, evidence_id FROM entity_evidence ORDER BY entity_id").all()).toEqual([{ entity_id: "entity:api:POST:/transfer", evidence_id: "evidence:api" }, { entity_id: "entity:feature:transfer", evidence_id: "evidence:api" }]);
    expect(database.prepare("SELECT predicate FROM claims").all()).toEqual([{ predicate: "exposes_api" }]);
    expect(database.prepare("SELECT state FROM semantic_concepts").all()).toEqual([{ state: "DISCOVERED_CONCEPT" }, { state: "DISCOVERED_CONCEPT" }]);
    commitProposal(database, { id: "proposal:one", operation: "claim.propose", actor: "reviewer", entityId: "claim:transfer-policy", evidenceIds: ["evidence:api"], reason: "review", payload: { subjectId: "entity:feature:transfer", predicate: "requires_identity_verification", object: true } }, { allowedActors: ["reviewer"], minimumEvidence: 1 });
    expect(database.prepare("SELECT operation FROM events WHERE operation = 'claim.propose'").all()).toEqual([{ operation: "claim.propose" }]);
    expect(database.prepare("SELECT predicate FROM claims WHERE id = 'claim:transfer-policy'").all()).toEqual([{ predicate: "requires_identity_verification" }]);
    expect(database.prepare("SELECT evidence_id FROM claim_evidence WHERE claim_id = 'claim:transfer-policy'").all()).toEqual([{ evidence_id: "evidence:api" }]);
    commitProposal(database, { id: "proposal:entity", operation: "entity.propose", actor: "reviewer", entityId: "entity:policy:transfer", evidenceIds: ["evidence:api"], reason: "review", payload: { type: "eligibility_policy", attributes: { enabled: true } } }, { allowedActors: ["reviewer"], minimumEvidence: 1 });
    commitProposal(database, { id: "proposal:relation", operation: "relation.propose", actor: "reviewer", entityId: "relation:transfer-policy", evidenceIds: ["evidence:api"], reason: "review", payload: { fromId: "entity:feature:transfer", type: "requires", toId: "entity:policy:transfer" } }, { allowedActors: ["reviewer"], minimumEvidence: 1 });
    commitProposal(database, { id: "proposal:attach", operation: "evidence.attach", actor: "reviewer", entityId: "ignored-by-attach", evidenceIds: ["evidence:api"], reason: "review", payload: { targetKind: "entity", targetId: "entity:policy:transfer" } }, { allowedActors: ["reviewer"], minimumEvidence: 1 });
    commitProposal(database, { id: "proposal:supersede", operation: "claim.supersede", actor: "reviewer", entityId: "claim:transfer-policy:v2", evidenceIds: ["evidence:api"], reason: "review", payload: { subjectId: "entity:feature:transfer", predicate: "requires_identity_verification", object: false, supersedesId: "claim:transfer-policy" } }, { allowedActors: ["reviewer"], minimumEvidence: 1 });
    commitProposal(database, { id: "proposal:invalidate", operation: "evidence.invalidate", actor: "reviewer", entityId: "evidence:api", evidenceIds: ["evidence:api"], reason: "review", payload: {} }, { allowedActors: ["reviewer"], minimumEvidence: 1 });
    expect(database.prepare("SELECT state FROM claims WHERE id = 'claim:transfer-policy'").all()).toEqual([{ state: "SUPERSEDED" }]);
    expect(database.prepare("SELECT type FROM semantic_relations WHERE id = 'relation:transfer-policy'").all()).toEqual([{ type: "requires" }]);
    expect(database.prepare("SELECT state FROM evidence WHERE id = 'evidence:api'").all()).toEqual([{ state: "INVALIDATED" }]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM semantic_concepts WHERE state = 'DISCOVERED_CONCEPT'").all()).toEqual([{ count: 3 }]);
    expect(database.prepare("SELECT operation FROM events ORDER BY operation").all()).toEqual([{ operation: "claim.propose" }, { operation: "claim.supersede" }, { operation: "entity.propose" }, { operation: "evidence.attach" }, { operation: "evidence.invalidate" }, { operation: "graph.materialize" }, { operation: "relation.propose" }, { operation: "sync.apply" }]); database.close();
  });
});
