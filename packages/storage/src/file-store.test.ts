import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evidenceRecords, initializeFileStore, projectSource, recordEvidence, reindexFileStore, specBrainDirectory, verifyFileStore, writeClaim } from "./file-store.js";

const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
describe("file source of truth", () => {
  it("rebuilds an index and propagates stale evidence", () => {
    const project = mkdtempSync(join(tmpdir(), "brain-store-")); writeFileSync(join(project, "input.txt"), "first\n"); const root = initializeFileStore(project);
    writeFileSync(join(root, "sources.json"), JSON.stringify([projectSource(root, project)])); writeFileSync(join(root, "profile.json"), JSON.stringify({ status: "APPROVED", entries: [], updatedAt: new Date().toISOString() }));
    const evidence = recordEvidence(root, { citation: { sourceId: "project", path: "input.txt", range: [1, 1], contentHash: hash("first"), revision: "local" }, kind: "open", observation: { value: "first" }, extractor: { id: "test", version: "1" }, confidence: 1, authority: 1 }, "agent");
    writeClaim(root, { id: "claim", feature: "feature", predicate: "open", object: {}, evidenceIds: [evidence.id], state: "ACTIVE", recordedAt: new Date().toISOString() }, "agent");
    expect(reindexFileStore(root)).toEqual({ evidence: 1, claims: 1 }); writeFileSync(join(project, "input.txt"), "second\n"); expect(verifyFileStore(root, "test")).toMatchObject({ stale: [evidence.id], claimsNeedingReview: ["claim"] }); expect(reindexFileStore(root)).toEqual({ evidence: 1, claims: 1 }); expect(evidenceRecords(root)[0]?.state).toBe("STALE"); expect(readFileSync(join(root, "claims", "feature", "claim.json"), "utf8")).toContain("NEEDS_REVIEW");
  });
});
