import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { checkApiParity, parseOpenApi, scanMobileRepository } from "./index.js";
import { checkNavigationParity, scanNavigation } from "./navigation.js";

describe("API parity", () => {
  it("extracts request/response schemas and produces evidence-backed UNKNOWN rather than a false missing claim", () => {
    const root = mkdtempSync(join(tmpdir(), "mobile-spec-brain-api-")); mkdirSync(join(root, "android")); mkdirSync(join(root, "ios"));
    const openapi = join(root, "openapi.json");
    const document = {
      components: { schemas: { Transfer: { type: "object", required: ["amount"], properties: { amount: { type: "number" } } } } },
      paths: {
        "/transfer": {
          post: {
            operationId: "transfer",
            tags: ["payments"],
            requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Transfer" } } } },
            responses: {
              "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Transfer" } } } },
              "422": {},
            },
          },
        },
      },
    };
    writeFileSync(openapi, JSON.stringify(document));
    writeFileSync(join(root, "android", "TransferApi.kt"), '@POST("/transfer") fun transfer() = Unit');
    const findings = checkApiParity(parseOpenApi(openapi), scanMobileRepository(join(root, "android"), "android"), scanMobileRepository(join(root, "ios"), "ios"));
    expect(findings).toMatchObject([{ type: "UNKNOWN", android: { path: "/transfer" }, ios: undefined }]);
    expect(findings[0]!.operation.statusCodes).toEqual(["200", "422"]);
    expect(findings[0]!.operation.requestBody).toMatchObject({ type: "object", properties: { amount: { type: "number" } } });
    expect(findings[0]!.operation.responses["422"]!.schema).toEqual({ status: "UNKNOWN", reason: "SCHEMA_NOT_DECLARED" });
  });
  it("matches path placeholders by position and does not treat iOS UNKNOWN as a method match", () => {
    const root = mkdtempSync(join(tmpdir(), "mobile-spec-brain-api-")); mkdirSync(join(root, "android")); mkdirSync(join(root, "ios"));
    const openapi = join(root, "openapi.json");
    writeFileSync(openapi, JSON.stringify({ paths: { "/api/v1/accounts/{accountId}": { get: { responses: { "200": {} } } }, "/transfer": { post: { responses: { "200": {} } } } } }));
    writeFileSync(join(root, "android", "AccountApi.kt"), 'const val ACCOUNTS = "api/v1/accounts/{id}"\ninterface AccountApi {\n  @GET(\n    ACCOUNTS\n  )\n  fun account(@Path("id") id: String): String\n}');
    writeFileSync(join(root, "ios", "Transfer.swift"), 'client.get("/transfer")');
    const operations = parseOpenApi(openapi);
    const android = scanMobileRepository(join(root, "android"), "android");
    const ios = scanMobileRepository(join(root, "ios"), "ios");
    expect(android).toMatchObject([{ method: "GET", normalizedPath: "/api/v1/accounts/{0}", bindings: [{ name: "id", location: "path" }] }]);
    expect(ios).toMatchObject([{ method: "GET", normalizedPath: "/transfer" }]);
    const findings = checkApiParity(operations, android, ios);
    expect(findings.find((finding) => finding.operation.path === "/api/v1/accounts/{accountId}")).toMatchObject({ android: { method: "GET" }, ios: undefined });
    expect(findings.find((finding) => finding.operation.path === "/transfer")).toMatchObject({ android: undefined, ios: undefined });
  });
  it("does not claim a missing navigation implementation", () => {
    const root = mkdtempSync(join(tmpdir(), "mobile-spec-brain-nav-")); mkdirSync(join(root, "android")); mkdirSync(join(root, "ios"));
    writeFileSync(join(root, "android", "Nav.kt"), 'composable("transfer") { }');
    expect(checkNavigationParity(scanNavigation(join(root, "android"), "android"), scanNavigation(join(root, "ios"), "ios"))).toMatchObject([{ type: "UNKNOWN", route: "transfer" }]);
  });
});
