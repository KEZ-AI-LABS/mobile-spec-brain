import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOpenApi } from "./index.js";
describe("OpenAPI parser", () => it("keeps deterministic contracts without scanning app source", () => { const root = mkdtempSync(join(tmpdir(), "openapi-")); const file = join(root, "api.json"); writeFileSync(file, JSON.stringify({ paths: { "/users/{id}": { get: { tags: ["Users"], responses: { 200: { description: "ok" } } } } } })); expect(parseOpenApi(file)).toMatchObject([{ method: "GET", normalizedPath: "/users/{0}", tags: ["Users"] }]); }));
