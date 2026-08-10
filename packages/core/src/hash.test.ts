import { describe, expect, it } from "vitest";
import { sha256, stableJson, stableStringify } from "./index.js";

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
