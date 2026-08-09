import { describe, expect, it } from "vitest";
import { extractionCacheKey, sha256, stableJson, stableStringify } from "./index.js";

describe("extractionCacheKey", () => {
  const base = {
    contentHash: "a",
    extractorId: "api",
    extractorVersion: "1",
    schemaVersion: "1",
    promptVersion: "1",
    modelVersion: "m",
  };

  it("is deterministic and sensitive to every input", () => {
    expect(extractionCacheKey(base)).toBe(extractionCacheKey(base));
    expect(extractionCacheKey(base)).not.toBe(extractionCacheKey({ ...base, extractorVersion: "2" }));
    expect(extractionCacheKey(base)).not.toBe(extractionCacheKey({ ...base, schemaVersion: "2" }));
  });

  it("does not depend on the property order of the literal at the call site", () => {
    const reordered = {
      modelVersion: base.modelVersion,
      promptVersion: base.promptVersion,
      schemaVersion: base.schemaVersion,
      extractorVersion: base.extractorVersion,
      extractorId: base.extractorId,
      contentHash: base.contentHash,
    };
    expect(extractionCacheKey(reordered)).toBe(extractionCacheKey(base));
  });

  it("separates fields so concatenation cannot collide", () => {
    expect(extractionCacheKey({ ...base, extractorId: "ap", extractorVersion: "i1" })).not.toBe(
      extractionCacheKey(base),
    );
  });
});

describe("stable serialization", () => {
  it("ignores key order at every depth", () => {
    const left = { b: 1, a: { d: 2, c: [{ f: 3, e: 4 }] } };
    const right = { a: { c: [{ e: 4, f: 3 }], d: 2 }, b: 1 };
    expect(stableStringify(left)).toBe(stableStringify(right));
    expect(stableJson(left)).toBe(stableJson(right));
  });

  it("preserves array order", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("terminates file output with a newline", () => {
    expect(stableJson({ a: 1 }).endsWith("\n")).toBe(true);
  });

  it("hashes strings with sha256", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
