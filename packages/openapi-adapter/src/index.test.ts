import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOpenApi } from "./index.js";

describe("OpenAPI parser", () => it("keeps resolved schemas and unknown circular refs without scanning app source", () => {
  const root = mkdtempSync(join(tmpdir(), "openapi-")); const file = join(root, "api.json");
  const document = { components: { schemas: { User: { type: "object", properties: { id: { type: "string" } } }, Loop: { $ref: "#/components/schemas/Loop" } } }, paths: { "/users/{id}": { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], get: { operationId: "getUser", tags: ["Users"], responses: { 200: { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } }, 500: { content: { "application/json": { schema: { $ref: "#/components/schemas/Loop" } } } } } } } } };
  writeFileSync(file, JSON.stringify(document));
  expect(parseOpenApi(file)).toMatchObject([{ method: "GET", normalizedPath: "/users/{0}", operationId: "getUser", parameters: [{ name: "id", required: true }], responses: { "200": { schema: { type: "object" } }, "500": { schema: { status: "UNKNOWN", reason: "CIRCULAR_REF" } } } }]);
}));
