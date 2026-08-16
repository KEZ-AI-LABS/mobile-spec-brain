import { describe, expect, it } from "vitest";
import {
  buildFileSpec,
  isSpecSection,
  selectSpecSection,
  type FeatureCoverageRecord,
  type FileClaim,
  type FileEvidence,
} from "./index.js";

const recordedAt = "2026-01-01T00:00:00.000Z";

function evidence(suffix: string, state: FileEvidence["state"] = "ACTIVE"): FileEvidence {
  return {
    id: `ev_${suffix.repeat(64).slice(0, 64)}`,
    citation: {
      sourceId: "project",
      path: "src/Transfer.kt",
      range: [1, 2],
      contentHash: `sha256:${"a".repeat(64)}`,
      revision: "local",
    },
    kind: "network-wrapper",
    observation: { note: "observed" },
    extractor: { id: "agent", version: "1" },
    confidence: 0.8,
    authority: 0.6,
    state,
    recordedAt,
  };
}

function claim(id: string, object: unknown, evidenceIds: string[]): FileClaim {
  return { id, feature: "transfer", predicate: "open", object, evidenceIds, state: "ACTIVE", recordedAt };
}

function coverage(sections: FeatureCoverageRecord["sections"]): FeatureCoverageRecord {
  return {
    feature: "transfer",
    displayName: "Transfer",
    analysisId: "analysis_test",
    sections,
    updatedAt: recordedAt,
  };
}

describe("buildFileSpec", () => {
  it("projects generic claim objects into typed sections", () => {
    const active = evidence("a");
    const spec = buildFileSpec(
      "transfer",
      [
        claim("api", { method: "POST", path: "/transfer" }, [active.id]),
        claim("nav", { direction: "incoming", route: "/home" }, [active.id]),
        claim("impl", { platform: "android", status: "IMPLEMENTED" }, [active.id]),
        claim("frame", { nodeId: "1:2", name: "Transfer" }, [active.id]),
      ],
      [active],
    );

    expect(spec.api).toMatchObject([{ method: "POST", path: "/transfer", state: "ACTIVE" }]);
    expect(spec.navigation.incoming).toMatchObject([{ route: "/home" }]);
    expect(spec.implementations).toMatchObject([{ platform: "android" }]);
    expect(spec.figmaFrames).toMatchObject([{ nodeId: "1:2" }]);
  });

  it("is byte-stable across builds", () => {
    const active = evidence("a");
    const claims = [claim("api", { method: "GET", path: "/a" }, [active.id])];
    expect(JSON.stringify(buildFileSpec("transfer", claims, [active]))).toBe(
      JSON.stringify(buildFileSpec("transfer", claims, [active])),
    );
  });

  it("measures completeness against the fixed protocol instead of the number of claims", () => {
    const stale = evidence("b", "STALE");
    const active = evidence("a");
    const spec = buildFileSpec(
      "transfer",
      [
        claim("ok", { method: "GET", path: "/a" }, [active.id]),
        claim("bad", { method: "GET", path: "/b" }, [stale.id]),
      ],
      [active, stale],
      coverage([
        { section: "product", status: "ANALYZED", evidenceIds: [active.id] },
        { section: "design", status: "NOT_APPLICABLE", evidenceIds: [] },
        { section: "api", status: "ANALYZED", evidenceIds: [stale.id] },
        { section: "implementation", status: "SOURCE_UNAVAILABLE", evidenceIds: [] },
        { section: "navigation", status: "UNKNOWN", evidenceIds: [] },
      ]),
    );

    expect(spec.completeness).toEqual({
      totalSections: 5,
      completeSections: 2,
      incompleteSections: 3,
      staleSections: 1,
      ratio: 0.4,
    });
    expect(spec.coverage.find((item) => item.section === "api")?.state).toBe("NEEDS_REVIEW");
  });

  it("marks a claim NEEDS_REVIEW when its evidence is not active", () => {
    const stale = evidence("b", "STALE");
    const spec = buildFileSpec("transfer", [claim("bad", { method: "GET", path: "/b" }, [stale.id])], [stale]);
    expect(spec.api[0]?.state).toBe("NEEDS_REVIEW");
    expect(spec.unknowns).toEqual(expect.arrayContaining([expect.objectContaining({ field: "bad" })]));
  });

  it("reports protocol coverage as unknown when no analysis record exists", () => {
    const spec = buildFileSpec("transfer", [], []);
    expect(spec.unknowns).toHaveLength(5);
    expect(spec.unknowns[0]).toMatchObject({ field: "coverage.product", reason: "UNKNOWN" });
    expect(spec.completeness.ratio).toBe(0);
  });

  it("cannot report 100 percent merely because every existing claim is active", () => {
    const active = evidence("a");
    const spec = buildFileSpec(
      "transfer",
      [claim("impl", { platform: "android", status: "DONE" }, [active.id])],
      [active],
    );
    expect(spec.implementations).toHaveLength(1);
    expect(spec.completeness.ratio).toBe(0);
  });
});

describe("selectSpecSection", () => {
  it("empties every projection except the selected one", () => {
    const active = evidence("a");
    const full = buildFileSpec(
      "transfer",
      [
        claim("api", { method: "POST", path: "/transfer" }, [active.id]),
        claim("nav", { direction: "incoming", route: "/home" }, [active.id]),
      ],
      [active],
    );

    const api = selectSpecSection(full, "api");
    expect(api.api).toHaveLength(1);
    expect(api.navigation).toEqual({ incoming: [], outgoing: [] });
    expect(api.figmaFrames).toEqual([]);
    expect(api.implementations).toEqual([]);

    // Provenance survives narrowing.
    expect(api.claims).toHaveLength(2);
    expect(api.graphHash).toBe(full.graphHash);
  });

  it("recognises exactly the documented section names", () => {
    expect(isSpecSection("api")).toBe(true);
    expect(isSpecSection("unknowns")).toBe(true);
    expect(isSpecSection("everything")).toBe(false);
  });
});
