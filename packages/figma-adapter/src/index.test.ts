import { describe, expect, it } from "vitest";
import { figmaSnapshots } from "./index.js";
describe("Figma adapter", () => {
  it("preserves stable frame identities", () => {
    const snapshots = figmaSnapshots("source:figma", { version: "v1", document: { id: "0", name: "Root", type: "DOCUMENT", children: [{ id: "1", name: "Login", type: "FRAME" }] } });
    expect(snapshots).toMatchObject([{ id: "block:source:figma:figma:1", metadata: { kind: "figma-frame" } }]);
  });
});
