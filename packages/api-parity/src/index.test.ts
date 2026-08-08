import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { checkApiParity, parseOpenApi, scanMobileRepository } from "./index.js";
import { checkNavigationParity, scanNavigation } from "./navigation.js";

describe("API parity", () => {
  it("produces evidence-backed UNKNOWN rather than a false missing claim", () => {
    const root = mkdtempSync(join(tmpdir(), "mobile-spec-brain-api-")); mkdirSync(join(root, "android")); mkdirSync(join(root, "ios"));
    const openapi = join(root, "openapi.json");
    writeFileSync(openapi, JSON.stringify({ paths: { "/transfer": { post: { responses: { "200": {}, "422": {} } } } } }));
    writeFileSync(join(root, "android", "TransferApi.kt"), '@POST("/transfer") fun transfer() = Unit');
    const findings = checkApiParity(parseOpenApi(openapi), scanMobileRepository(join(root, "android"), "android"), scanMobileRepository(join(root, "ios"), "ios"));
    expect(findings).toMatchObject([{ type: "UNKNOWN", android: { path: "/transfer" }, ios: undefined }]);
    expect(findings[0]!.operation.statusCodes).toEqual(["200", "422"]);
  });
  it("does not claim a missing navigation implementation", () => {
    const root = mkdtempSync(join(tmpdir(), "mobile-spec-brain-nav-")); mkdirSync(join(root, "android")); mkdirSync(join(root, "ios"));
    writeFileSync(join(root, "android", "Nav.kt"), 'composable("transfer") { }');
    expect(checkNavigationParity(scanNavigation(join(root, "android"), "android"), scanNavigation(join(root, "ios"), "ios"))).toMatchObject([{ type: "UNKNOWN", route: "transfer" }]);
  });
});
