import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySourceSync, commitProposal, materializeSpecs, persistEvidence, persistFindings, SqliteEventStore, openWorkspaceDatabase } from "./index.js";

describe("SQLite storage", () => {
  it("migrates and persists append-only events", async () => {
    const database = openWorkspaceDatabase(join(mkdtempSync(join(tmpdir(), "specweave-")), "workspace.sqlite"));
    const store = new SqliteEventStore(database);
    await store.append({ id: "evt-1", occurredAt: new Date("2026-01-01T00:00:00Z"), actor: "test", operation: "sync.apply", entityType: "source", entityId: "source:api", evidenceIds: [], reason: "test", payload: {} });
    expect(await store.list("source:api")).toHaveLength(1);
    expect(database.prepare("SELECT version FROM schema_migrations").all()).toEqual([{ version: "001_initial" }]);
    database.close();
  });
  it("atomically records raw blocks, cursor, and sync event", () => {
    const database = openWorkspaceDatabase(join(mkdtempSync(join(tmpdir(), "specweave-")), "workspace.sqlite"));
    database.prepare("INSERT INTO workspaces (id, name, created_at) VALUES ('workspace:test', 'test', '2026-01-01')").run();
    const hash = "a".repeat(64); const now = new Date("2026-01-01T00:00:00Z");
    applySourceSync(database, { actor: "test", source: { id: "source:api", type: "OPENAPI", displayName: "API", configuration: {} }, changeSet: { sourceId: "source:api" as never, sourceType: "OPENAPI", cursor: hash, changes: [{ kind: "ADDED", entityId: "entity:api" as never, revision: hash }], fetchedAt: now }, blocks: [{ id: "block:api" as never, sourceEntityId: "entity:api" as never, revision: hash, contentHash: hash, content: { path: "/transfer" }, metadata: {} }] });
    expect(database.prepare("SELECT cursor FROM sync_cursors").all()).toEqual([{ cursor: hash }]);
    expect(database.prepare("SELECT external_id FROM raw_blocks").all()).toEqual([{ external_id: "block:api" }]);
    persistEvidence(database, [{ id: "evidence:api" as never, kind: "API_CONTRACT", subject: "api.POST./transfer", predicate: "defines", value: {}, extractionConfidence: 1, authority: 1, provenance: { sourceEntityId: "entity:api" as never, rawBlockId: "block:api" as never, revision: hash, extractorId: "test", extractorVersion: "1" } }]);
    expect(database.prepare("SELECT subject FROM evidence").all()).toEqual([{ subject: "api.POST./transfer" }]);
    materializeSpecs(database, [{ featureKey: "transfer", displayName: "transfer", key: "api.post./transfer", value: { path: "/transfer" }, confidence: 1, evidenceIds: ["evidence:api"] }], "test");
    expect(database.prepare("SELECT canonical_key FROM features").all()).toEqual([{ canonical_key: "transfer" }]);
    persistFindings(database, [{ id: "finding:transfer", type: "UNKNOWN", featureKey: "transfer", explanation: { reason: "missing evidence" } }]);
    expect(database.prepare("SELECT type FROM findings").all()).toEqual([{ type: "UNKNOWN" }]);
    commitProposal(database, { id: "proposal:one", operation: "spec.propose", actor: "reviewer", entityId: "spec:api.post./transfer", evidenceIds: ["evidence:api"], reason: "review", payload: {} }, { allowedActors: ["reviewer"], minimumEvidence: 1 });
    expect(database.prepare("SELECT operation FROM events WHERE operation = 'spec.propose'").all()).toEqual([{ operation: "spec.propose" }]);
    expect(database.prepare("SELECT operation FROM events ORDER BY operation").all()).toEqual([{ operation: "spec.materialize" }, { operation: "spec.propose" }, { operation: "sync.apply" }]); database.close();
  });
});
