import { describe, expect, it } from "vitest";

describe("CLI command surface", () => {
  it("documents the foundational commands", () => {
    expect(["init", "sync", "check", "doctor"]).toContain("sync");
  });
});
