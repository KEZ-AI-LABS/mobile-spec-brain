#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { applySourceSync, commitProposal, getClaim, getEvidence, getFeature, listFeatureClaims, materializeSemanticGraph, openWorkspaceDatabase, persistEvidence, persistFindings, readSyncState, SqliteEventStore } from "@mobile-spec-brain/storage";
import { checkApiParity, checkNavigationParity, extractImplementationEvidence, extractOpenApiEvidence, mobileSnapshots, openApiSnapshots, parseOpenApi, scanMobileRepository, scanNavigation } from "@mobile-spec-brain/api-parity";
import { enforceSyncSafety, materializeApiSemantics, planBlockSync, sha256 } from "@mobile-spec-brain/core";
import { fetchFigmaFile, figmaSnapshots } from "@mobile-spec-brain/figma-adapter";
import { z } from "zod";

const projectRoot = process.env.INIT_CWD ?? process.cwd();
const workspaceDir = join(projectRoot, ".mobile-spec-brain");
const databasePath = join(workspaceDir, "workspace.sqlite");
const configPath = join(workspaceDir, "config.json");

function output(value: unknown, json: boolean): void {
  if (json) console.log(JSON.stringify(value, null, 2));
  else if (typeof value === "string") console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

function initialized(): boolean { return existsSync(databasePath) && existsSync(configPath); }

function init(json: boolean): void {
  mkdirSync(workspaceDir, { recursive: true });
  const database = openWorkspaceDatabase(databasePath);
  const workspace = database.prepare("SELECT id, name FROM workspaces LIMIT 1").get() as { id: string; name: string } | undefined;
  if (!workspace) database.prepare("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)").run(`workspace:${randomUUID()}`, projectRoot.split("/").at(-1) ?? "mobile-spec-brain", new Date().toISOString());
  if (!existsSync(configPath)) writeFileSync(configPath, JSON.stringify({ version: 1, sources: [], profiles: ["mobile-generic"] }, null, 2) + "\n");
  database.close();
  output({ status: "initialized", workspace: workspaceDir, config: configPath, database: databasePath }, json);
}

function requireInitialized(json: boolean): boolean {
  if (initialized()) return true;
  output({ status: "error", code: "WORKSPACE_NOT_INITIALIZED", message: "Run `mobile-spec-brain init` first." }, json);
  process.exitCode = 2;
  return false;
}

const configSchema = z.object({ version: z.literal(1), profiles: z.array(z.string()).default(["mobile-generic"]), sources: z.array(z.object({ id: z.string().min(1), type: z.enum(["OPENAPI", "ANDROID", "IOS", "FIGMA"]), path: z.string().default(""), fileKey: z.string().optional() })).default([]), safety: z.object({ maxClaimInvalidation: z.number().int().positive().optional(), maxSourceChangeRatio: z.number().positive().max(1).optional() }).optional(), mutationPolicy: z.object({ allowedActors: z.array(z.string()).optional(), minimumEvidence: z.number().int().positive().optional() }).optional() });
type WorkspaceConfig = z.infer<typeof configSchema>; type ConfigSource = WorkspaceConfig["sources"][number];
function config(): WorkspaceConfig { return configSchema.parse(JSON.parse(readFileSync(configPath, "utf8"))); }
function sourceSet(): { openapi?: ConfigSource; android?: ConfigSource; ios?: ConfigSource; figma?: ConfigSource } {
  const sources = config().sources ?? [];
  return { openapi: sources.find((source) => source.type === "OPENAPI"), android: sources.find((source) => source.type === "ANDROID"), ios: sources.find((source) => source.type === "IOS"), figma: sources.find((source) => source.type === "FIGMA") };
}

async function sync(plan: boolean, json: boolean): Promise<void> {
  if (!requireInitialized(json)) return;
  const sources = config().sources ?? [];
  if (sources.length === 0) { output({ status: "unavailable", mode: plan ? "PLAN" : "APPLY", code: "NO_SOURCES_CONFIGURED", message: "Configure OPENAPI, ANDROID, and IOS local sources in .mobile-spec-brain/config.json.", configuredSources: 0 }, json); process.exitCode = 3; return; }
  const inspected = sources.map((source) => ({ id: source.id, type: source.type, path: source.type === "FIGMA" ? source.fileKey ?? "" : resolve(projectRoot, source.path), exists: source.type === "FIGMA" ? Boolean(source.fileKey && process.env.FIGMA_TOKEN) : existsSync(resolve(projectRoot, source.path)) }));
  const api = sourceSet().openapi;
  if (api && inspected.every((source) => source.exists)) {
    const database = openWorkspaceDatabase(databasePath); const sourcePath = resolve(projectRoot, api.path); const blocks = openApiSnapshots(api.id, sourcePath);
    const cursor = sha256(readFileSync(sourcePath, "utf8")); const state = readSyncState(database, api.id);
    const planned = planBlockSync(api.id as never, "OPENAPI", cursor, state, blocks);
    const policyConfig = config() as WorkspaceConfig & { safety?: { maxClaimInvalidation?: number; maxSourceChangeRatio?: number } };
    enforceSyncSafety({ changedEntities: planned.changeSet.changes.length, knownEntities: state.blocks.size, invalidatedClaims: planned.dirtyBlockIds.length }, { maxClaimInvalidation: policyConfig.safety?.maxClaimInvalidation ?? 500, maxSourceChangeRatio: policyConfig.safety?.maxSourceChangeRatio ?? 0.3 });
    const mobile = [sourceSet().android, sourceSet().ios].filter((source): source is ConfigSource => Boolean(source));
    const mobilePlans = mobile.map((source) => { const platform = source.type === "ANDROID" ? "android" : "ios" as const; const snapshot = mobileSnapshots(source.id, resolve(projectRoot, source.path), platform); const state = readSyncState(database, source.id); const cursor = sha256(JSON.stringify(snapshot.map((item) => item.contentHash))); return { source, platform, snapshot, planned: planBlockSync(source.id as never, "LOCAL_GIT", cursor, state, snapshot) }; });
    if (!plan) {
      const evidence = extractOpenApiEvidence(api.id, blocks); applySourceSync(database, { source: { id: api.id, type: "OPENAPI", displayName: api.id, configuration: { path: api.path } }, changeSet: planned.changeSet, blocks, actor: "cli" }); persistEvidence(database, evidence); materializeSemanticGraph(database, materializeApiSemantics(evidence), "cli");
      for (const item of mobilePlans) { const implementation = extractImplementationEvidence(item.snapshot); applySourceSync(database, { source: { id: item.source.id, type: "LOCAL_GIT", displayName: item.source.id, configuration: { path: item.source.path, platform: item.platform } }, changeSet: item.planned.changeSet, blocks: item.snapshot, actor: "cli" }); persistEvidence(database, implementation); }
      const figma = sourceSet().figma;
      if (figma?.fileKey && process.env.FIGMA_TOKEN) { const document = await fetchFigmaFile(figma.fileKey, process.env.FIGMA_TOKEN); const snapshots = figmaSnapshots(figma.id, document); const previous = readSyncState(database, figma.id); const figmaPlan = planBlockSync(figma.id as never, "FIGMA", document.version, previous, snapshots); applySourceSync(database, { source: { id: figma.id, type: "FIGMA", displayName: figma.id, configuration: { fileKey: figma.fileKey } }, changeSet: figmaPlan.changeSet, blocks: snapshots, actor: "cli" }); }
    }
    database.close();
    output({ status: plan ? "planned" : "synchronized", mode: plan ? "PLAN" : "APPLY", sources: inspected, changes: planned.changeSet.changes.length + mobilePlans.reduce((sum, item) => sum + item.planned.changeSet.changes.length, 0), dirtyBlocks: planned.dirtyBlockIds.length + mobilePlans.reduce((sum, item) => sum + item.planned.dirtyBlockIds.length, 0) }, json);
    return;
  }
  output({ status: inspected.every((source) => source.exists) ? (plan ? "planned" : "synchronized") : "error", mode: plan ? "PLAN" : "APPLY", sources: inspected, message: "No OpenAPI source configured for evidence persistence." }, json);
  if (inspected.some((source) => !source.exists)) process.exitCode = 2;
}

function check(json: boolean): void {
  if (!requireInitialized(json)) return;
  const { openapi, android, ios } = sourceSet();
  if (!openapi || !android || !ios) { output({ status: "unavailable", code: "API_PARITY_SOURCES_REQUIRED", message: "Configure one OPENAPI, ANDROID, and IOS source before API parity can run." }, json); process.exitCode = 3; return; }
  try {
    const operations = parseOpenApi(resolve(projectRoot, openapi.path));
    const androidEvidence = scanMobileRepository(resolve(projectRoot, android.path), "android");
    const iosEvidence = scanMobileRepository(resolve(projectRoot, ios.path), "ios");
    const findings = checkApiParity(operations, androidEvidence, iosEvidence);
    const navigationFindings = checkNavigationParity(scanNavigation(resolve(projectRoot, android.path), "android"), scanNavigation(resolve(projectRoot, ios.path), "ios"));
    const database = openWorkspaceDatabase(databasePath); persistFindings(database, [...findings.map((finding) => ({ id: `finding:${finding.id}`, type: finding.type, featureKey: finding.operation.path.split("/").filter(Boolean)[0] ?? "root", explanation: finding })), ...navigationFindings.map((finding) => ({ id: `finding:${finding.id}`, type: finding.type, featureKey: finding.route.split("/").filter(Boolean)[0] ?? "root", explanation: finding }))]); database.close();
    output({ status: "complete", rules: ["api-parity", "navigation-parity"], operations: operations.length, evidence: { android: androidEvidence.length, ios: iosEvidence.length }, findings: [...findings, ...navigationFindings] }, json);
  } catch (error) { output({ status: "error", code: "API_PARITY_INPUT_INVALID", message: error instanceof Error ? error.message : String(error) }, json); process.exitCode = 2; }
}

function doctor(json: boolean): void {
  if (!requireInitialized(json)) return;
  const database = openWorkspaceDatabase(databasePath);
  const migrations = database.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as { version: string }[];
  database.close();
  output({ status: "healthy", database: databasePath, migrations: migrations.map(({ version }) => version), capabilities: ["workspace initialization", "SQLite migrations", "append-only events", "API parity evidence scan"] }, json);
}

function propose(args: string[], json: boolean): void {
  if (!requireInitialized(json)) return;
  const fileIndex = args.indexOf("--file"); const proposalPath = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
  if (!proposalPath) { output({ status: "error", code: "PROPOSAL_FILE_REQUIRED", message: "Use `mobile-spec-brain propose --file proposal.json`." }, json); process.exitCode = 2; return; }
  try {
    const proposal = JSON.parse(readFileSync(resolve(projectRoot, proposalPath), "utf8")); const database = openWorkspaceDatabase(databasePath);
    const actors = config() as WorkspaceConfig & { mutationPolicy?: { allowedActors?: string[]; minimumEvidence?: number } };
    const accepted = commitProposal(database, proposal, { allowedActors: actors.mutationPolicy?.allowedActors ?? ["reviewer"], minimumEvidence: actors.mutationPolicy?.minimumEvidence ?? 1 }); database.close();
    output({ status: "accepted", proposal: accepted }, json);
  } catch (error) { output({ status: "rejected", code: "PROPOSAL_REJECTED", message: error instanceof Error ? error.message : String(error) }, json); process.exitCode = 2; }
}
async function readCommand(kind: "feature" | "claim" | "evidence" | "history", id: string | undefined, json: boolean): Promise<void> {
  if (!requireInitialized(json)) return;
  if (!id) { output({ status: "error", code: "IDENTIFIER_REQUIRED" }, json); process.exitCode = 2; return; }
  const database = openWorkspaceDatabase(databasePath);
  const value = kind === "feature" ? getFeature(database, id) : kind === "claim" ? getClaim(database, id) : kind === "evidence" ? getEvidence(database, id) : await new SqliteEventStore(database).list(id);
  database.close(); output({ status: "complete", [kind]: value }, json);
}
function renderWiki(json: boolean): void {
  if (!requireInitialized(json)) return;
  const database = openWorkspaceDatabase(databasePath); const rows = listFeatureClaims(database); database.close();
  const byFeature = Map.groupBy(rows, (row) => row.feature); const wikiDir = join(workspaceDir, "wiki"); mkdirSync(wikiDir, { recursive: true });
  for (const [feature, claims] of byFeature) { if (!feature) continue; const body = [`# ${claims?.[0]?.displayName ?? feature}`, "", "> Generated by Mobile Spec Brain. Do not edit directly.", "", "## Claims", "", ...(claims ?? []).map((claim) => `- \`${claim.predicate}\` — ${claim.object} (confidence: ${claim.confidence})`), ""].join("\n"); writeFileSync(join(wikiDir, `${feature}.md`), body); }
  output({ status: "rendered", directory: wikiDir, features: byFeature.size }, json);
}

const [command, ...args] = process.argv.slice(2);
const json = args.includes("--json");
switch (command) {
  case "init": init(json); break;
  case "sync": await sync(args.includes("--plan"), json); break;
  case "check": check(json); break;
  case "doctor": doctor(json); break;
  case "propose": propose(args, json); break;
  case "feature": await readCommand("feature", args.find((arg) => !arg.startsWith("--")), json); break;
  case "claim": await readCommand("claim", args.find((arg) => !arg.startsWith("--")), json); break;
  case "evidence": await readCommand("evidence", args.find((arg) => !arg.startsWith("--")), json); break;
  case "history": await readCommand("history", args.find((arg) => !arg.startsWith("--")), json); break;
  case "wiki": renderWiki(json); break;
  default:
    console.log("Usage: mobile-spec-brain <init|sync|check|doctor|propose|feature|claim|evidence|history|wiki> [--plan] [--json]");
    process.exitCode = command ? 2 : 0;
}
