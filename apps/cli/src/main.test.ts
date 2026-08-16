import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it } from "vitest";

const entry = resolve(process.cwd(), "dist/main.js");
const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

interface RunResult {
  status: number;
  json: Record<string, never>;
}

let root: string;

function run(...args: string[]): RunResult {
  const result = spawnSync(process.execPath, [entry, ...args], { cwd: root, encoding: "utf8" });
  let json = {};
  try {
    json = JSON.parse(result.stdout) as Record<string, never>;
  } catch {
    json = {};
  }
  return { status: result.status ?? 1, json: json as Record<string, never> };
}

function write(name: string, value: unknown): void {
  writeFileSync(join(root, name), JSON.stringify(value, null, 2));
}

const citation = (path: string, line: number, content: string) => ({
  sourceId: "project",
  path,
  range: [line, line],
  contentHash: hash(content),
  revision: "local",
});

const transferCitation = citation("src/Transfer.kt", 2, 'fun transfer() = "active"');

function approveProfile(): void {
  write(".spec-brain/profile.json", {
    status: "APPROVED",
    entries: [
      {
        key: "http.client",
        value: "internal wrapper",
        citations: [citation("src/Transfer.kt", 1, "class InternalHttpClient")],
      },
    ],
    updatedAt: new Date().toISOString(),
  });
}

function projectAnalysis(summary = "AI located transfer wrapper", claimId = "analysis-transfer") {
  return {
    schemaVersion: 1,
    repository: { revision: "local" },
    extractor: { id: "agent", version: "1", model: "test", promptVersion: "p1" },
    filesRead: [{ sourceId: "project", path: "src/Transfer.kt" }],
    excluded: ["build"],
    profile: {
      entries: [
        {
          key: "http.client",
          value: "internal wrapper",
          citations: [citation("src/Transfer.kt", 1, "class InternalHttpClient")],
        },
      ],
    },
    features: [
      {
        key: "transfer",
        displayName: "Transfer",
        coverage: [
          { section: "product", status: "UNKNOWN", reason: "No product source", evidenceKeys: [] },
          { section: "design", status: "SOURCE_UNAVAILABLE", reason: "No design source", evidenceKeys: [] },
          { section: "api", status: "UNKNOWN", reason: "API applicability not established", evidenceKeys: [] },
          { section: "implementation", status: "ANALYZED", evidenceKeys: ["implementation"] },
          { section: "navigation", status: "UNKNOWN", reason: "Not established", evidenceKeys: [] },
        ],
        evidence: [
          {
            key: "implementation",
            citation: transferCitation,
            kind: "network-wrapper",
            observation: { note: summary },
            confidence: 0.8,
            authority: 0.6,
          },
        ],
        claims: [
          {
            id: claimId,
            predicate: "implementation",
            object: { platform: "android", status: "IMPLEMENTED", location: "Transfer.kt" },
            evidenceKeys: ["implementation"],
          },
        ],
      },
    ],
  };
}

function recordTransferEvidence(): string {
  write("evidence.json", {
    citation: transferCitation,
    kind: "network-wrapper",
    observation: { note: "AI located transfer wrapper" },
    extractor: { id: "agent", version: "1", promptVersion: "p1" },
    confidence: 0.8,
    authority: 0.6,
  });
  const recorded = run("evidence", "record", "--file", "evidence.json");
  expect(recorded.status).toBe(0);
  return (recorded.json as unknown as { evidence: { id: string } }).evidence.id;
}

function proposeTransferClaims(evidenceId: string): void {
  write("api-claim.json", {
    id: "claim-transfer",
    feature: "transfer",
    predicate: "api.contract",
    object: { method: "POST", path: "/transfer", parameters: [], responses: { "200": { type: "object" } } },
    evidenceIds: [evidenceId],
    state: "ACTIVE",
    recordedAt: new Date().toISOString(),
  });
  write("nav-claim.json", {
    id: "claim-nav",
    feature: "transfer",
    predicate: "navigation",
    object: { direction: "incoming", route: "/home", platform: "android" },
    evidenceIds: [evidenceId],
    state: "ACTIVE",
    recordedAt: new Date().toISOString(),
  });
  expect(run("claim", "propose", "--file", "api-claim.json").status).toBe(0);
  expect(run("claim", "propose", "--file", "nav-claim.json").status).toBe(0);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "spec-brain-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "Transfer.kt"), 'class InternalHttpClient\nfun transfer() = "active"\n');
  expect(run("init").status).toBe(0);
});

describe("file-backed CLI workflow", () => {
  it("rejects an invented citation and propagates a source change", () => {
    approveProfile();

    write("invalid.json", {
      citation: citation("src/Invented.kt", 1, "class InternalHttpClient"),
      kind: "network-wrapper",
      observation: {},
      extractor: { id: "agent", version: "1" },
      confidence: 0.8,
      authority: 0.6,
    });
    expect(run("evidence", "record", "--file", "invalid.json").status).toBe(2);

    const evidenceId = recordTransferEvidence();
    proposeTransferClaims(evidenceId);

    writeFileSync(join(root, "src", "Transfer.kt"), 'class InternalHttpClient\nfun transfer() = "changed"\n');
    const verified = run("verify", "--write");
    expect(verified.status).toBe(0);
    expect(verified.json).toMatchObject({
      stale: [evidenceId],
      claimsNeedingReview: ["claim-nav", "claim-transfer"],
    });
    expect(readFileSync(join(root, ".spec-brain", "claims", "transfer", "claim-transfer.json"), "utf8")).toContain(
      "NEEDS_REVIEW",
    );
  });

  it("validates and ingests one project-wide analysis bundle without a scope", () => {
    write("analysis.json", projectAnalysis());

    const contract = run("analysis", "contract");
    expect(contract.status).toBe(0);
    expect(contract.json).toMatchObject({ contract: { features: { coverageSections: expect.any(Array) } } });

    const validated = run("analysis", "validate", "--file", "analysis.json");
    expect(validated.status).toBe(0);
    expect(validated.json).toMatchObject({ status: "valid", features: [{ key: "transfer" }] });
    expect(run("analysis", "ingest", "--file", "analysis.json").status).toBe(2);

    const ingested = run("analysis", "ingest", "--file", "analysis.json", "--confirm-human");
    expect(ingested.status).toBe(0);
    expect(ingested.json).toMatchObject({ analysis: { status: "INGESTED" } });
    expect(run("profile", "read").json).toMatchObject({ profile: { status: "APPROVED" } });

    const repeated = run("analysis", "ingest", "--file", "analysis.json", "--confirm-human");
    expect(repeated.json).toMatchObject({ analysis: { status: "UNCHANGED" } });
  });

  it("accepts a changed proposal instead of hiding it behind a scope cache", () => {
    write("analysis.json", projectAnalysis("first", "analysis-first"));
    expect(run("analysis", "ingest", "--file", "analysis.json", "--confirm-human").status).toBe(0);

    write("analysis.json", projectAnalysis("second", "analysis-second"));
    const second = run("analysis", "ingest", "--file", "analysis.json", "--confirm-human");
    expect(second.status).toBe(0);
    expect(second.json).toMatchObject({ analysis: { status: "INGESTED" } });
    expect(run("evidence", "query").json).toMatchObject({ evidence: expect.arrayContaining([expect.any(Object)]) });
  });

  it("renders a byte-stable spec and narrows it with --section", () => {
    approveProfile();
    proposeTransferClaims(recordTransferEvidence());

    expect(run("spec", "render", "transfer").status).toBe(0);
    const jsonPath = join(root, ".spec-brain", "spec", "transfer.spec.json");
    const full = readFileSync(jsonPath, "utf8");
    expect(JSON.parse(full)).toMatchObject({
      api: [{ method: "POST", path: "/transfer" }],
      navigation: { incoming: [{ route: "/home" }] },
      completeness: { staleSections: 0, ratio: 0 },
    });

    expect(run("spec", "render", "transfer").status).toBe(0);
    expect(readFileSync(jsonPath, "utf8")).toBe(full);

    expect(run("spec", "render", "transfer", "--section", "api").status).toBe(0);
    const narrowed = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(narrowed.api).toHaveLength(1);
    expect(narrowed.navigation).toEqual({ incoming: [], outgoing: [] });
    expect(readFileSync(jsonPath, "utf8")).not.toBe(full);

    const markdown = readFileSync(join(root, ".spec-brain", "spec", "transfer.md"), "utf8");
    expect(markdown).toContain("## API contracts");
    expect(markdown).not.toContain("## Navigation");
  });

  it("rejects an unknown section name", () => {
    approveProfile();
    proposeTransferClaims(recordTransferEvidence());
    const result = run("spec", "render", "transfer", "--section", "everything");
    expect(result.status).toBe(2);
    expect(result.json).toMatchObject({ message: expect.stringContaining("Unknown section") });
  });

  it("requires explicit human confirmation to invalidate evidence", () => {
    approveProfile();
    const evidenceId = recordTransferEvidence();
    proposeTransferClaims(evidenceId);

    expect(run("evidence", "invalidate", "--id", evidenceId).status).toBe(2);

    const invalidated = run("evidence", "invalidate", "--id", evidenceId, "--confirm-human");
    expect(invalidated.status).toBe(0);
    expect(invalidated.json).toMatchObject({
      status: "invalidated",
      claimsNeedingReview: ["claim-nav", "claim-transfer"],
    });
    expect(run("coverage").json).toMatchObject({ coverage: { evidence: { invalidated: 1 } } });
  });

  it("refuses to record evidence before the profile is approved", () => {
    write("evidence.json", {
      citation: transferCitation,
      kind: "network-wrapper",
      observation: {},
      extractor: { id: "agent", version: "1" },
      confidence: 0.8,
      authority: 0.6,
    });
    const result = run("evidence", "record", "--file", "evidence.json");
    expect(result.status).toBe(2);
    expect(result.json).toMatchObject({ message: expect.stringContaining("APPROVED") });
  });

  it("reports a missing store instead of crashing", () => {
    const empty = mkdtempSync(join(tmpdir(), "spec-brain-empty-"));
    const result = spawnSync(process.execPath, [entry, "coverage"], { cwd: empty, encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ code: "SPEC_BRAIN_NOT_INITIALIZED" });
  });

  it("does not create a derived index directory", () => {
    expect(existsSync(join(root, ".spec-brain", ".index"))).toBe(false);
  });
});

describe("cite", () => {
  it("emits a citation that evidence record accepts unchanged", () => {
    approveProfile();
    const cited = run("cite", "src/Transfer.kt", "2", "2");
    expect(cited.status).toBe(0);

    const { citation } = cited.json as unknown as { citation: Record<string, unknown> };
    expect(citation).toMatchObject({ sourceId: "project", path: "src/Transfer.kt", range: [2, 2] });

    write("evidence.json", {
      citation,
      kind: "network-wrapper",
      observation: { note: "cited by the CLI" },
      extractor: { id: "agent", version: "1" },
      confidence: 0.8,
      authority: 0.6,
    });
    expect(run("evidence", "record", "--file", "evidence.json").status).toBe(0);
  });

  it("reports a usable error for a bad range or a bad path", () => {
    expect(run("cite", "src/Transfer.kt", "1", "99").json).toMatchObject({
      message: expect.stringContaining("outside"),
    });
    expect(run("cite", "../escape.kt", "1", "1").json).toMatchObject({
      message: expect.stringContaining("escapes source root"),
    });
    expect(run("cite", "src/Transfer.kt", "x", "1").json).toMatchObject({
      message: expect.stringContaining("must be integers"),
    });
    expect(run("cite").json).toMatchObject({ message: expect.stringContaining("spec-brain cite") });
  });
});

describe("read-only verify and explicit state application", () => {
  function setUpDrift(): void {
    approveProfile();
    proposeTransferClaims(recordTransferEvidence());
    writeFileSync(join(root, "src", "Transfer.kt"), 'class InternalHttpClient\nfun transfer() = "changed"\n');
  }

  it("exits zero on a clean store", () => {
    approveProfile();
    proposeTransferClaims(recordTransferEvidence());
    const eventsBefore = readdirSync(join(root, ".spec-brain", "events")).length;
    const result = run("verify", "--check");
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ drift: false, changes: 0 });
    expect(readdirSync(join(root, ".spec-brain", "events"))).toHaveLength(eventsBefore);
  });

  it("exits non-zero while drift is unresolved, on every run", () => {
    setUpDrift();
    expect(run("verify", "--check").status).toBe(1);
    expect(run("verify", "--check").status).toBe(1);
  });

  it("reports without writing unless --write is explicit", () => {
    setUpDrift();
    const claimPath = join(root, ".spec-brain", "claims", "transfer", "claim-transfer.json");
    const result = run("verify");
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ drift: true, changes: 3 });
    expect(readFileSync(claimPath, "utf8")).toContain('"ACTIVE"');

    const applied = run("verify", "--write");
    expect(applied.status).toBe(0);
    expect(readFileSync(claimPath, "utf8")).toContain("NEEDS_REVIEW");
  });
});
