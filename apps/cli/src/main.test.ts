import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const command = (root: string, ...args: string[]) => spawnSync(process.execPath, [resolve(process.cwd(), "dist/main.js"), ...args, "--json"], { cwd: root, encoding: "utf8" });

describe("file-backed CLI workflow", () => {
  it("rejects invented citations, marks changed evidence stale, and rebuilds its index", () => {
    const root = mkdtempSync(join(tmpdir(), "spec-brain-")); mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "Transfer.kt"), "class InternalHttpClient\nfun transfer() = \"active\"\n");
    expect(command(root, "init").status).toBe(0);
    const profileCitation = { sourceId: "project", path: "src/Transfer.kt", range: [1, 1], contentHash: hash("class InternalHttpClient"), revision: "local" };
    writeFileSync(join(root, "profile.json"), JSON.stringify({ entries: [{ key: "http.client", value: "internal wrapper", citations: [profileCitation] }] }));
    expect(command(root, "profile", "propose", "--file", "profile.json").status).toBe(0);
    writeFileSync(join(root, ".spec-brain", "profile.json"), JSON.stringify({ status: "APPROVED", entries: [{ key: "http.client", value: "internal wrapper", citations: [profileCitation] }], updatedAt: new Date().toISOString() }, null, 2));
    const badCitation = { ...profileCitation, path: "src/Invented.kt" }; writeFileSync(join(root, "invalid.json"), JSON.stringify({ citation: badCitation, kind: "network-wrapper", observation: {}, extractor: { id: "agent", version: "1" }, confidence: 0.8, authority: 0.6 }));
    expect(command(root, "evidence", "record", "--file", "invalid.json").status).toBe(2);
    const citation = { sourceId: "project", path: "src/Transfer.kt", range: [2, 2], contentHash: hash("fun transfer() = \"active\""), revision: "local" };
    writeFileSync(join(root, "evidence.json"), JSON.stringify({ citation, kind: "network-wrapper", observation: { note: "AI located transfer wrapper" }, extractor: { id: "agent", version: "1", promptVersion: "p1" }, confidence: 0.8, authority: 0.6 }));
    const recorded = command(root, "evidence", "record", "--file", "evidence.json"); expect(recorded.status, String(recorded.stderr)).toBe(0);
    const evidence = JSON.parse(recorded.stdout).evidence;
    writeFileSync(join(root, "claim.json"), JSON.stringify({ id: "claim-transfer", feature: "transfer", predicate: "api.contract", object: { method: "POST", path: "/transfer", parameters: [], responses: { "200": { type: "object" } } }, evidenceIds: [evidence.id], state: "ACTIVE", recordedAt: new Date().toISOString() }));
    expect(command(root, "claim", "propose", "--file", "claim.json").status).toBe(0);
    writeFileSync(join(root, "proposal.json"), JSON.stringify({ extractor: { id: "agent", version: "1", model: "test", promptVersion: "p1" }, observations: [JSON.parse(readFileSync(join(root, "evidence.json"), "utf8"))] }));
    expect(command(root, "extract", "--scope", "src", "--file", "proposal.json").status).toBe(0);
    const reused = command(root, "extract", "--scope", "src", "--file", "proposal.json"); expect(reused.status).toBe(0); expect(JSON.parse(reused.stdout).status).toBe("reused");
    expect(command(root, "reindex").status).toBe(0);
    expect(command(root, "spec", "render", "transfer").status).toBe(0);
    const firstRender = readFileSync(join(root, ".spec-brain", "spec", "transfer.spec.json"), "utf8");
    expect(JSON.parse(firstRender)).toMatchObject({ api: [{ method: "POST", path: "/transfer" }], completeness: { staleFields: 0 } });
    expect(command(root, "spec", "render", "transfer").status).toBe(0);
    expect(readFileSync(join(root, ".spec-brain", "spec", "transfer.spec.json"), "utf8")).toBe(firstRender);
    writeFileSync(join(root, "src", "Transfer.kt"), "class InternalHttpClient\nfun transfer() = \"changed\"\n");
    const verified = command(root, "verify"); expect(verified.status).toBe(0); expect(JSON.parse(verified.stdout)).toMatchObject({ stale: [evidence.id], claimsNeedingReview: ["claim-transfer"] });
    expect(readFileSync(join(root, ".spec-brain", "claims", "transfer", "claim-transfer.json"), "utf8")).toContain("NEEDS_REVIEW");
    expect(command(root, "reindex").status).toBe(0);
  });
});
