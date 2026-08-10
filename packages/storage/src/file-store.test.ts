import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyVerification,
  buildCitation,
  claimRecords,
  coverage,
  detectRevision,
  evidenceRecords,
  ingestAnalysisBundle,
  initializeFileStore,
  invalidateEvidence,
  projectSource,
  readFeatureCoverage,
  recordEvidence,
  specBrainDirectory,
  stableJson,
  validateAnalysisBundle,
  verifyFileStore,
  verifiedSnapshot,
  writeClaim,
  type EvidenceRecordInput,
} from "./file-store.js";

const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const recordedAt = () => new Date().toISOString();

let project: string;
let root: string;

function approveProfile(): void {
  writeFileSync(join(root, "profile.json"), stableJson({ status: "APPROVED", entries: [], updatedAt: recordedAt() }));
}

function observation(overrides: Partial<EvidenceRecordInput> = {}): EvidenceRecordInput {
  return {
    citation: {
      sourceId: "project",
      path: "input.txt",
      range: [1, 1],
      contentHash: hash("first"),
      revision: "local",
    },
    kind: "open",
    observation: { value: "first" },
    extractor: { id: "test", version: "1" },
    confidence: 1,
    authority: 1,
    ...overrides,
  };
}

function analysisBundle(summary = "first reading", claimId = "analysis-claim") {
  return {
    schemaVersion: 1,
    repository: { revision: "local" },
    extractor: { id: "test-agent", version: "1", model: "test" },
    filesRead: [{ sourceId: "project", path: "input.txt" }],
    excluded: ["build"],
    features: [
      {
        key: "feature",
        displayName: "Feature",
        coverage: [
          { section: "product", status: "UNKNOWN", reason: "No product source", evidenceKeys: [] },
          { section: "design", status: "SOURCE_UNAVAILABLE", reason: "No design source", evidenceKeys: [] },
          { section: "api", status: "UNKNOWN", reason: "API applicability not established", evidenceKeys: [] },
          { section: "implementation", status: "ANALYZED", evidenceKeys: ["implementation"] },
          { section: "navigation", status: "UNKNOWN", reason: "Navigation not established", evidenceKeys: [] },
        ],
        evidence: [
          {
            key: "implementation",
            citation: observation().citation,
            kind: "implementation",
            observation: { summary },
            confidence: 1,
            authority: 1,
          },
        ],
        claims: [
          {
            id: claimId,
            predicate: "implementation",
            object: { platform: "test", status: "IMPLEMENTED" },
            evidenceKeys: ["implementation"],
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "brain-store-"));
  writeFileSync(join(project, "input.txt"), "first\n");
  root = initializeFileStore(project);
  writeFileSync(join(root, "sources.json"), stableJson([projectSource(root, project)]));
  approveProfile();
});

describe("evidence identity", () => {
  it("keeps distinct observations on the same lines as distinct records", () => {
    const first = recordEvidence(root, observation(), "agent");
    const second = recordEvidence(
      root,
      observation({ kind: "different-kind", observation: { value: "second reading" } }),
      "agent",
    );

    expect(second.id).not.toBe(first.id);
    expect(second.observation).toEqual({ value: "second reading" });
    expect(evidenceRecords(root)).toHaveLength(2);
  });

  it("stays idempotent when the identical observation is recorded twice", () => {
    const first = recordEvidence(root, observation(), "agent");
    const again = recordEvidence(root, observation(), "agent");

    expect(again.id).toBe(first.id);
    expect(again.recordedAt).toBe(first.recordedAt);
    expect(evidenceRecords(root)).toHaveLength(1);
  });
});

describe("source-root containment", () => {
  it("refuses a citation that leaves the source root through a symbolic link", () => {
    const outside = mkdtempSync(join(tmpdir(), "brain-outside-"));
    const secret = join(outside, "secrets.env");
    writeFileSync(secret, "TOKEN=super-secret\n");
    symlinkSync(secret, join(project, "link.env"));

    expect(() =>
      recordEvidence(
        root,
        observation({
          citation: {
            sourceId: "project",
            path: "link.env",
            range: [1, 1],
            contentHash: hash("TOKEN=super-secret"),
            revision: "local",
          },
        }),
        "agent",
      ),
    ).toThrow(/escapes source root/);
  });

  it("refuses a citation that leaves the source root lexically", () => {
    expect(() =>
      recordEvidence(
        root,
        observation({
          citation: {
            sourceId: "project",
            path: "../escape.txt",
            range: [1, 1],
            contentHash: hash("x"),
            revision: "local",
          },
        }),
        "agent",
      ),
    ).toThrow(/escapes source root/);
  });

  it("does not echo cited content when a hash does not match", () => {
    writeFileSync(join(project, "secret.txt"), "TOKEN=super-secret\n");
    expect(() =>
      recordEvidence(
        root,
        observation({
          citation: {
            sourceId: "project",
            path: "secret.txt",
            range: [1, 1],
            contentHash: hash("something else"),
            revision: "local",
          },
        }),
        "agent",
      ),
    ).toThrow(/hash mismatch/);

    try {
      recordEvidence(
        root,
        observation({
          citation: {
            sourceId: "project",
            path: "secret.txt",
            range: [1, 1],
            contentHash: hash("something else"),
            revision: "local",
          },
        }),
        "agent",
      );
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret");
    }
  });
});

describe("project-wide analysis bundles", () => {
  it("validates and ingests one reviewed bundle without a caller-provided scope", () => {
    const bundle = analysisBundle();
    expect(validateAnalysisBundle(root, bundle)).toMatchObject({ filesRead: 1, features: [{ key: "feature" }] });
    expect(() => ingestAnalysisBundle(root, bundle, "agent")).toThrow(/human actor/);

    const ingested = ingestAnalysisBundle(root, bundle, "human");
    expect(ingested.status).toBe("INGESTED");
    expect(ingested.evidenceIds).toHaveLength(1);
    expect(ingested.claimIds).toEqual(["analysis-claim"]);
    expect(readFeatureCoverage(root, "feature")?.sections).toHaveLength(5);

    const repeated = ingestAnalysisBundle(root, bundle, "human");
    expect(repeated.status).toBe("UNCHANGED");
    expect(evidenceRecords(root)).toHaveLength(1);
  });

  it("validates every new proposal instead of returning a scope cache hit", () => {
    ingestAnalysisBundle(root, analysisBundle("first reading", "claim-first"), "human");
    ingestAnalysisBundle(root, analysisBundle("second reading", "claim-second"), "human");

    expect(evidenceRecords(root).map((item) => item.observation)).toEqual(
      expect.arrayContaining([{ summary: "second reading" }, { summary: "first reading" }]),
    );
  });

  it("requires every fixed protocol coverage section", () => {
    const bundle = analysisBundle();
    bundle.features[0]!.coverage.pop();
    expect(() => validateAnalysisBundle(root, bundle)).toThrow(/Coverage section 'navigation' is required/);
  });

  it("requires evidence for complete coverage statuses", () => {
    const bundle = analysisBundle();
    bundle.features[0]!.coverage[0] = {
      section: "product",
      status: "ANALYZED",
      reason: "claimed complete without evidence",
      evidenceKeys: [],
    };
    expect(() => validateAnalysisBundle(root, bundle)).toThrow(/requires supporting evidence/);
  });

  it("rejects path-like feature and claim identifiers from an untrusted bundle", () => {
    const unsafeFeature = analysisBundle();
    unsafeFeature.features[0]!.key = "../../outside";
    expect(() => validateAnalysisBundle(root, unsafeFeature)).toThrow(/safe record key/);

    const unsafeClaim = analysisBundle();
    unsafeClaim.features[0]!.claims[0]!.id = "../outside";
    expect(() => validateAnalysisBundle(root, unsafeClaim)).toThrow(/safe record key/);
  });

  it("requires cited files to appear in the analysis audit manifest", () => {
    const bundle = analysisBundle();
    bundle.filesRead = [];
    expect(() => validateAnalysisBundle(root, bundle)).toThrow(/not declared in filesRead/);
  });

  it("rejects duplicate discovered feature keys", () => {
    const bundle = analysisBundle();
    bundle.features.push(bundle.features[0]!);
    expect(() => validateAnalysisBundle(root, bundle)).toThrow(/Feature keys must be unique/);
  });
});

describe("verification and invalidation", () => {
  it("propagates stale evidence to dependent claims", () => {
    const evidence = recordEvidence(root, observation(), "agent");
    writeClaim(
      root,
      {
        id: "claim",
        feature: "feature",
        predicate: "open",
        object: {},
        evidenceIds: [evidence.id],
        state: "ACTIVE",
        recordedAt: recordedAt(),
      },
      "agent",
    );

    writeFileSync(join(project, "input.txt"), "second\n");
    expect(verifyFileStore(root)).toMatchObject({
      stale: [evidence.id],
      claimsNeedingReview: ["claim"],
    });
    expect(evidenceRecords(root)[0]?.state).toBe("ACTIVE");
    expect(readFileSync(join(root, "claims", "feature", "claim.json"), "utf8")).toContain('"ACTIVE"');

    applyVerification(root, "test");
    expect(evidenceRecords(root)[0]?.state).toBe("STALE");
    expect(readFileSync(join(root, "claims", "feature", "claim.json"), "utf8")).toContain("NEEDS_REVIEW");
  });

  it("lets only a human invalidate, and reviews dependent claims immediately", () => {
    const evidence = recordEvidence(root, observation(), "agent");
    writeClaim(
      root,
      {
        id: "claim",
        feature: "feature",
        predicate: "open",
        object: {},
        evidenceIds: [evidence.id],
        state: "ACTIVE",
        recordedAt: recordedAt(),
      },
      "agent",
    );

    expect(() => invalidateEvidence(root, evidence.id, "agent")).toThrow(/human/);

    const result = invalidateEvidence(root, evidence.id, "human");
    expect(result.evidence.state).toBe("INVALIDATED");
    expect(result.claimsNeedingReview).toEqual(["claim"]);
    expect(claimRecords(root)[0]?.state).toBe("NEEDS_REVIEW");
    expect(coverage(root).evidence.invalidated).toBe(1);
  });

  it("leaves invalidated evidence invalidated across verification", () => {
    const evidence = recordEvidence(root, observation(), "agent");
    invalidateEvidence(root, evidence.id, "human");
    applyVerification(root, "test");
    expect(evidenceRecords(root)[0]?.state).toBe("INVALIDATED");
  });
});

describe("claims", () => {
  it("rejects a claim that references missing evidence", () => {
    expect(() =>
      writeClaim(
        root,
        {
          id: "claim",
          feature: "feature",
          predicate: "open",
          object: {},
          evidenceIds: [`ev_${"0".repeat(64)}`],
          state: "ACTIVE",
          recordedAt: recordedAt(),
        },
        "agent",
      ),
    ).toThrow(/does not exist/);
  });

  it("supersedes a prior claim instead of rewriting it", () => {
    const evidence = recordEvidence(root, observation(), "agent");
    const base = {
      feature: "feature",
      predicate: "open",
      object: {},
      evidenceIds: [evidence.id],
      state: "ACTIVE" as const,
    };
    writeClaim(root, { ...base, id: "first", recordedAt: recordedAt() }, "agent");
    writeClaim(
      root,
      { ...base, id: "second", supersedes: "first", recordedAt: recordedAt() },
      "agent",
      "claim.supersede",
    );

    const byId = new Map(claimRecords(root).map((claim) => [claim.id, claim.state]));
    expect(byId.get("first")).toBe("SUPERSEDED");
    expect(byId.get("second")).toBe("ACTIVE");
  });
});

describe("profile gate", () => {
  it("blocks evidence recording until the profile is approved", () => {
    writeFileSync(
      join(root, "profile.json"),
      stableJson({ status: "PROPOSED", entries: [], updatedAt: recordedAt() }),
    );
    expect(() => recordEvidence(root, observation(), "agent")).toThrow(/APPROVED/);
  });
});

describe("buildCitation", () => {
  it("produces a citation the store accepts without further work", () => {
    writeFileSync(join(project, "Api.kt"), "package a\n\nfun call() = 1\n");
    const citation = buildCitation(root, { path: "Api.kt", range: [3, 3] });

    expect(citation).toMatchObject({ sourceId: "project", path: "Api.kt", range: [3, 3] });
    expect(citation.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(() => recordEvidence(root, observation({ citation }), "agent")).not.toThrow();
  });

  it("round-trips every boundary of a file", () => {
    writeFileSync(join(project, "Api.kt"), "one\ntwo\nthree\n");
    for (const range of [
      [1, 1],
      [3, 3],
      [1, 3],
      [2, 3],
    ] as [number, number][]) {
      const citation = buildCitation(root, { path: "Api.kt", range });
      expect(() =>
        recordEvidence(root, observation({ citation, observation: { range: range.join("-") } }), "agent"),
      ).not.toThrow();
    }
  });

  it("round-trips a file with no trailing newline", () => {
    writeFileSync(join(project, "NoNewline.kt"), "only line");
    const citation = buildCitation(root, { path: "NoNewline.kt", range: [1, 1] });
    expect(() => recordEvidence(root, observation({ citation }), "agent")).not.toThrow();
  });

  it("refuses the phantom line a trailing newline creates", () => {
    writeFileSync(join(project, "Api.kt"), "one\ntwo\nthree\n");
    expect(() => buildCitation(root, { path: "Api.kt", range: [4, 4] })).toThrow(/outside Api.kt \(3 lines\)/);
  });

  it("refuses a path outside the source root", () => {
    expect(() => buildCitation(root, { path: "../escape.kt", range: [1, 1] })).toThrow(/escapes source root/);
  });

  it("refuses an unordered or non-positive range", () => {
    writeFileSync(join(project, "Api.kt"), "one\ntwo\n");
    expect(() => buildCitation(root, { path: "Api.kt", range: [2, 1] })).toThrow(/must be ordered/);
    expect(() => buildCitation(root, { path: "Api.kt", range: [0, 1] })).toThrow(/positive integer/);
  });

  it("falls back to a local revision outside a git repository", () => {
    expect(detectRevision(root)).toBe("local");
    expect(buildCitation(root, { path: "input.txt", range: [1, 1] }).revision).toBe("local");
  });

  it("honours an explicit revision", () => {
    expect(buildCitation(root, { path: "input.txt", range: [1, 1], revision: "v1.2.3" }).revision).toBe("v1.2.3");
  });
});

describe("verify as a CI gate", () => {
  function claimOn(evidenceId: string, id = "claim"): void {
    writeClaim(
      root,
      {
        id,
        feature: "feature",
        predicate: "open",
        object: {},
        evidenceIds: [evidenceId],
        state: "ACTIVE",
        recordedAt: recordedAt(),
      },
      "agent",
    );
  }

  it("reports no drift on a clean store", () => {
    claimOn(recordEvidence(root, observation(), "agent").id);
    const eventsBefore = readdirSync(join(root, "events")).length;
    expect(verifyFileStore(root)).toMatchObject({ drift: false, claimsNeedingReview: [], changes: 0 });
    expect(readdirSync(join(root, "events"))).toHaveLength(eventsBefore);
  });

  it("keeps reporting drift on repeated runs, not only on the transition", () => {
    claimOn(recordEvidence(root, observation(), "agent").id);
    writeFileSync(join(project, "input.txt"), "second\n");

    const first = verifyFileStore(root);
    expect(first).toMatchObject({ drift: true, claimsNeedingReview: ["claim"] });

    const second = verifyFileStore(root);
    expect(second).toMatchObject({ drift: true, claimsNeedingReview: ["claim"] });
  });

  it("reports drift for an orphaned citation", () => {
    claimOn(recordEvidence(root, observation(), "agent").id);
    rmSync(join(project, "input.txt"));
    expect(verifyFileStore(root)).toMatchObject({ drift: true, orphaned: [expect.any(String)] });
  });

  it("reports drift while a human invalidation is unresolved", () => {
    const evidence = recordEvidence(root, observation(), "agent");
    claimOn(evidence.id);
    invalidateEvidence(root, evidence.id, "human");
    expect(verifyFileStore(root).drift).toBe(true);
  });

  it("does not block CI on stale evidence used only by a superseded claim", () => {
    const oldEvidence = recordEvidence(root, observation(), "agent");
    claimOn(oldEvidence.id, "old-claim");

    writeFileSync(join(project, "input.txt"), "second\n");
    const newEvidence = recordEvidence(
      root,
      observation({
        citation: { ...observation().citation, contentHash: hash("second") },
        observation: { value: "second" },
      }),
      "agent",
    );
    writeClaim(
      root,
      {
        id: "new-claim",
        feature: "feature",
        predicate: "open",
        object: {},
        evidenceIds: [newEvidence.id],
        state: "ACTIVE",
        supersedes: "old-claim",
        recordedAt: recordedAt(),
      },
      "agent",
      "claim.supersede",
    );

    expect(verifyFileStore(root)).toMatchObject({
      drift: false,
      stale: [],
      historicalStale: [oldEvidence.id],
    });
  });

  it("writes transitions only when explicitly applied", () => {
    claimOn(recordEvidence(root, observation(), "agent").id);
    writeFileSync(join(project, "input.txt"), "second\n");
    const eventsBefore = readdirSync(join(root, "events")).length;

    expect(verifiedSnapshot(root).changes).toBe(2);
    expect(readdirSync(join(root, "events"))).toHaveLength(eventsBefore);
    expect(applyVerification(root, "test").changes).toBe(2);
    expect(readdirSync(join(root, "events"))).toHaveLength(eventsBefore + 1);
  });
});

describe("workspace layout", () => {
  it("creates the record directories and no derived index", () => {
    expect(specBrainDirectory(project)).toBe(root);
    for (const directory of ["evidence", "claims", "events", "analyses", "features", "spec"]) {
      expect(existsSync(join(root, directory))).toBe(true);
    }
    expect(existsSync(join(root, ".index"))).toBe(false);
  });
});
