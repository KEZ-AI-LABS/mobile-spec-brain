import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export interface NavigationEvidence { platform: "android" | "ios"; route: string; evidence: string; }
export interface NavigationFinding { id: string; type: "UNKNOWN"; route: string; android?: NavigationEvidence; ios?: NavigationEvidence; message: string; }

function sourceFiles(root: string): string[] { return readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? sourceFiles(join(root, entry.name)) : [join(root, entry.name)]); }

export function scanNavigation(root: string, platform: "android" | "ios"): NavigationEvidence[] {
  const pattern = platform === "android" ? /(?:composable|navigation)\s*\(\s*["']([^"']+)["']/g : /(?:navigationDestination|NavigationLink)\s*\(\s*(?:for:\s*)?["']([^"']+)["']/g;
  return sourceFiles(root).filter((file) => platform === "android" ? /\.kt$/i.test(file) : /\.swift$/i.test(file)).flatMap((file) => {
    const content = readFileSync(file, "utf8"); pattern.lastIndex = 0; const output: NavigationEvidence[] = [];
    for (let match = pattern.exec(content); match; match = pattern.exec(content)) output.push({ platform, route: match[1]!, evidence: `${platform}:${relative(root, file)}:${content.slice(0, match.index).split("\n").length}` });
    return output;
  });
}

export function checkNavigationParity(android: NavigationEvidence[], ios: NavigationEvidence[]): NavigationFinding[] {
  const routes = new Set([...android, ...ios].map((item) => item.route));
  return [...routes].flatMap((route) => { const a = android.find((item) => item.route === route); const i = ios.find((item) => item.route === route); return a && i ? [] : [{ id: `NAV-${route.replace(/[^A-Za-z0-9]+/g, "-")}`, type: "UNKNOWN" as const, route, android: a, ios: i, message: "Navigation evidence is absent on one platform; this is UNKNOWN." }]; });
}
