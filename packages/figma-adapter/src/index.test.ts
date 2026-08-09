import { describe, expect, it } from "vitest";
import { figmaSnapshots } from "./index.js";
describe("Figma adapter", () => {
  it("preserves stable frame identities", () => {
    const snapshots = figmaSnapshots("source:figma", { version: "v1", document: { id: "0", name: "Root", type: "DOCUMENT", children: [{ id: "1", name: "Login", type: "FRAME", children: [{ id: "2", name: "Title", type: "TEXT", characters: "Welcome" }, { id: "3", name: "Button", type: "INSTANCE", componentId: "component:button", componentProperties: { State: { value: "Enabled", type: "VARIANT" } } }] }] } });
    expect(snapshots).toMatchObject([{ id: "block:source:figma:figma:1", metadata: { kind: "figma-frame" }, content: { hierarchy: { children: [{ text: "Welcome" }, { componentId: "component:button", componentProperties: { State: { value: "Enabled" } } }] } } }]);
  });
});
