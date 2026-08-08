import { sha256, type RawBlockSnapshot } from "@specweave/core";

export interface FigmaNode { id: string; name: string; type: string; children?: FigmaNode[]; interactions?: unknown[]; }
export interface FigmaDocument { document: FigmaNode; version: string; }
export type FetchFigma = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

function flatten(node: FigmaNode): FigmaNode[] { return [node, ...(node.children ?? []).flatMap(flatten)]; }
export function figmaSnapshots(sourceId: string, document: FigmaDocument): readonly RawBlockSnapshot[] {
  return flatten(document.document).filter((node) => node.type === "FRAME").map((node) => {
    const content = { nodeId: node.id, name: node.name, interactions: node.interactions ?? [] }; const hash = sha256(JSON.stringify(content));
    return { id: `block:${sourceId}:figma:${node.id}` as never, sourceEntityId: `entity:${sourceId}:figma:${node.id}` as never, revision: `${document.version}:${hash}`, contentHash: hash, content, metadata: { kind: "figma-frame", figmaNodeId: node.id } };
  });
}
export async function fetchFigmaFile(fileKey: string, token: string, fetcher: FetchFigma = fetch): Promise<FigmaDocument> {
  const response = await fetcher(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}`, { headers: { "X-Figma-Token": token } });
  if (!response.ok) throw new Error(`Figma API failed with HTTP ${response.status}`);
  return response.json() as Promise<FigmaDocument>;
}
