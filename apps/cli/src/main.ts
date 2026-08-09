#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { extractionCacheKey, sha256 } from "@mobile-spec-brain/core";
import { claimRecords, coverage, evidenceRecords, graphQuery, initializeFileStore, projectSource, proposeProfile, readProfile, recordEvidence, reindexFileStore, specBrainDirectory, stableJson, verifyFileStore, writeClaim } from "@mobile-spec-brain/storage";

const projectRoot = process.cwd(); const root = specBrainDirectory(projectRoot); const json = process.argv.includes("--json"); const [command, subcommand, ...args] = process.argv.slice(2).filter((arg) => arg !== "--json");
function output(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }
function requireStore(): boolean { if (existsSync(root)) return true; output({ status: "error", code: "SPEC_BRAIN_NOT_INITIALIZED", message: "Run `spec-brain init` first." }); process.exitCode = 2; return false; }
function option(name: string): string | undefined { const commandArgs = [subcommand, ...args]; const index = commandArgs.indexOf(name); return index < 0 ? undefined : commandArgs[index + 1]; }
function fileInput(): unknown { const path = option("--file"); if (!path) throw new Error("A --file JSON payload is required."); return JSON.parse(readFileSync(resolve(projectRoot, path), "utf8")); }
function init(): void { initializeFileStore(projectRoot); const sourcesPath = join(root, "sources.json"); if ((JSON.parse(readFileSync(sourcesPath, "utf8")) as unknown[]).length === 0) writeFileSync(sourcesPath, stableJson([projectSource(root, projectRoot)])); output({ status: "initialized", root }); }
function profile(): void { if (!requireStore()) return; if (subcommand === "read") return output({ status: "complete", profile: readProfile(root) }); if (subcommand === "propose") return output({ status: "proposed", profile: proposeProfile(root, fileInput() as never, "agent") }); throw new Error("Use `spec-brain profile read|propose`. Human approval is a reviewed edit to .spec-brain/profile.json."); }
function evidence(): void { if (!requireStore()) return; if (subcommand === "query") return output({ status: "complete", evidence: evidenceRecords(root) }); if (subcommand === "record") return output({ status: "recorded", evidence: recordEvidence(root, fileInput() as never, "agent") }); throw new Error("Use `spec-brain evidence record|query`."); }
function claim(): void { if (!requireStore()) return; if (subcommand !== "propose" && subcommand !== "supersede") throw new Error("Use `spec-brain claim propose|supersede --file claim.json`."); const payload = fileInput() as never; output({ status: "recorded", claim: writeClaim(root, payload, "agent", subcommand === "supersede" ? "claim.supersede" : "claim.propose") }); }
function graph(): void { if (!requireStore()) return; if (subcommand !== "query") throw new Error("Use `spec-brain graph query [--feature name] [--predicate name] [--state state]`."); output({ status: "complete", ...graphQuery(root, { feature: option("--feature"), predicate: option("--predicate"), state: option("--state") }) }); }
function extract(): void { if (!requireStore()) return; const scope = option("--scope"); if (!scope) throw new Error("Use `spec-brain extract --scope <path-or-description>`."); const sources = JSON.parse(readFileSync(join(root, "sources.json"), "utf8")); const cacheKey = extractionCacheKey({ contentHash: sha256(stableJson(sources)), extractorId: "external-ai", extractorVersion: "1", schemaVersion: "file-protocol-v1", promptVersion: "citation-only", modelVersion: "external" }); output({ status: "ready", scope, extractionCacheKey: cacheKey, contract: "An AI/external agent may return only open observations with closed citations. Submit each result with `spec-brain evidence record --file evidence.json`; this CLI re-reads the cited file range and verifies its hash.", profile: readProfile(root).status }); }
function renderSpec(): void {
  if (!requireStore()) return;
  if (subcommand !== "render") throw new Error("Use `spec-brain spec render <feature> [--section section]`.");
  const feature = args.find((arg) => !arg.startsWith("--") && arg !== option("--section")); if (!feature) throw new Error("Feature is required.");
  const section = option("--section"); const claims = claimRecords(root).filter((item) => item.feature === feature).sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set(claims.flatMap((item) => item.evidenceIds)); const evidence = evidenceRecords(root).filter((item) => ids.has(item.id));
  const unknowns = claims.length === 0 ? [{ field: "claims", reason: "EVIDENCE_ABSENT", evidenceIds: [] }] : claims.filter((item) => item.state !== "ACTIVE").map((item) => ({ field: item.id, reason: item.state, evidenceIds: item.evidenceIds }));
  const known = claims.filter((item) => item.state === "ACTIVE").length; const total = claims.length + (unknowns.length === 0 ? 0 : 1);
  const view = { version: 1, feature, section: section ?? "all", completeness: { knownFields: known, unknownFields: total - known, ratio: total === 0 ? 0 : known / total }, claims, evidence, unknowns };
  const selected = section ? { ...view, claims: claims.filter((item) => item.predicate === section), evidence } : view;
  const directory = join(root, "spec"); mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, `${feature}.spec.json`), stableJson(selected));
  const quote = (value: string) => "`" + value + "`";
  const markdown = [
    `# ${feature}`, "", "> Derived view. Do not edit directly.", "", `- Completeness: ${(view.completeness.ratio * 100).toFixed(1)}% (${view.completeness.knownFields} active / ${view.completeness.unknownFields} unknown or review)`, `- Section: ${section ?? "all"}`,
    "", "## Claims", "", ...(selected.claims.length ? selected.claims.map((item) => `- ${quote(item.id)} · ${quote(item.predicate)} · **${item.state}** · evidence: ${item.evidenceIds.map(quote).join(", ")}`) : ["- UNKNOWN — EVIDENCE_ABSENT"]),
    "", "## Evidence", "", ...(evidence.length ? evidence.map((item) => `- ${quote(item.id)} · ${item.kind} · **${item.state}** · ${item.citation.sourceId}:${item.citation.path}:${item.citation.range.join("-")} · ${item.citation.contentHash}`) : ["- None."]),
    "", "## Unknowns", "", ...(unknowns.length ? unknowns.map((item) => `- ${quote(item.field)} — ${item.reason}`) : ["- None."]), "",
  ].join("\n");
  writeFileSync(join(directory, `${feature}.md`), markdown); output({ status: "rendered", feature, section: section ?? "all", output: join(root, "spec", `${feature}.spec.json`) });
}
try { if (command === "init") init(); else if (command === "profile") profile(); else if (command === "evidence") evidence(); else if (command === "claim") claim(); else if (command === "graph") graph(); else if (command === "extract") extract(); else if (command === "verify") { if (requireStore()) output({ status: "complete", ...verifyFileStore(root, "verifier") }); } else if (command === "reindex") { if (requireStore()) output({ status: "complete", ...reindexFileStore(root) }); } else if (command === "coverage") { if (requireStore()) output({ status: "complete", coverage: coverage(root) }); } else if (command === "spec") renderSpec(); else { console.log("Usage: spec-brain <init|profile|evidence|claim|graph|extract|verify|reindex|coverage|spec> [--json]"); process.exitCode = 2; } } catch (error) { output({ status: "error", message: error instanceof Error ? error.message : String(error) }); process.exitCode = 2; }
