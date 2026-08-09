import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function command(root: string, ...args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [resolve(process.cwd(), "dist/main.js"), ...args], { cwd: root, env: { ...process.env, INIT_CWD: root }, encoding: "utf8" });
}

describe("CLI end-to-end workflow", () => {
  it("runs init through source-spec and supports an unchanged second sync", () => {
    const root = mkdtempSync(join(tmpdir(), "mobile-spec-brain-cli-"));
    mkdirSync(join(root, "android")); mkdirSync(join(root, "ios"));
    const document = {
      components: { schemas: { Account: { type: "object", properties: { id: { type: "string" } } } } },
      paths: {
        "/api/v1/accounts/{accountId}": {
          get: {
            tags: ["accounts"],
            parameters: [{ name: "accountId", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Account" } } } } },
          },
        },
      },
    };
    writeFileSync(join(root, "openapi.json"), JSON.stringify(document));
    writeFileSync(join(root, "android", "AccountsApi.kt"), 'const val ACCOUNTS = "api/v1/accounts/{id}"\ninterface AccountsApi {\n@GET(ACCOUNTS)\nfun account(@Path("id") id: String): String\n}\ncomposable("accounts") {}');
    writeFileSync(join(root, "ios", "Accounts.swift"), 'client.get("api/v1/accounts/{id}")');
    const init = command(root, "init", "--json"); expect(init.status).toBe(0);
    const configPath = join(root, ".mobile-spec-brain", "config.json");
    writeFileSync(configPath, JSON.stringify({ version: 1, sources: [{ id: "api", type: "OPENAPI", path: "./openapi.json" }, { id: "android", type: "ANDROID", path: "./android" }, { id: "ios", type: "IOS", path: "./ios" }] }));
    for (const args of [["sync", "--plan", "--json"], ["sync", "--json"], ["sync", "--json"], ["check", "--json"], ["spec", "accounts", "--json"], ["spec", "accounts", "--section", "api", "--json"], ["spec", "--all", "--json"], ["wiki", "--json"]]) {
      const result = command(root, ...args); expect(result.status, String(result.stderr)).toBe(0);
    }
    const spec = JSON.parse(readFileSync(join(root, ".mobile-spec-brain", "spec", "accounts.spec.json"), "utf8"));
    expect(spec.api[0]).toMatchObject({ method: "GET", normalizedPath: "/api/v1/accounts/{0}" });
    expect(spec.api[0].implementations).toEqual(expect.arrayContaining([expect.objectContaining({ platform: "android", status: "IMPLEMENTED" }), expect.objectContaining({ platform: "ios", status: "IMPLEMENTED" })]));
    expect(spec.navigation.incoming).toEqual(expect.arrayContaining([expect.objectContaining({ route: "accounts", platform: "android" })]));
    expect(readFileSync(join(root, ".mobile-spec-brain", "spec", "accounts.md"), "utf8")).toContain("Generated source spec");
  });
});
