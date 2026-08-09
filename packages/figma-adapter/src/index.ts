import { sha256, type Evidence, type RawBlockSnapshot } from "@mobile-spec-brain/core";

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  characters?: string;
  componentId?: string;
  componentProperties?: Record<string, { value?: unknown; type?: string }>;
  children?: FigmaNode[];
  interactions?: unknown[];
}
export interface FigmaDocument { document: FigmaNode; version: string; }
export type FetchFigma = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

function flatten(node: FigmaNode): FigmaNode[] { return [node, ...(node.children ?? []).flatMap(flatten)]; }

function describeNode(node: FigmaNode): unknown {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    text: node.type === "TEXT" ? node.characters ?? "" : undefined,
    componentId: node.componentId,
    componentProperties: node.componentProperties,
    children: (node.children ?? []).map(describeNode),
  };
}

export function figmaSnapshots(sourceId: string, document: FigmaDocument): readonly RawBlockSnapshot[] {
  return flatten(document.document).filter((node) => node.type === "FRAME").map((node) => {
    const content = { nodeId: node.id, name: node.name, interactions: node.interactions ?? [], hierarchy: describeNode(node) };
    const hash = sha256(JSON.stringify(content));
    return { id: `block:${sourceId}:figma:${node.id}` as never, sourceEntityId: `entity:${sourceId}:figma:${node.id}` as never, revision: `${document.version}:${hash}`, contentHash: hash, content, metadata: { kind: "figma-frame", figmaNodeId: node.id } };
  });
}
export function extractFigmaEvidence(snapshots: readonly RawBlockSnapshot[]): readonly Evidence[] {
  return snapshots.map((snapshot) => {
    const value = snapshot.content as { nodeId: string };
    return { id: `evidence:${sha256(`${snapshot.id}:figma`)}` as never, kind: "DESIGN" as const, subject: `figma.frame.${value.nodeId}`, predicate: "defines_screen", value: snapshot.content, extractionConfidence: 0.95, authority: 0.7, provenance: { sourceEntityId: snapshot.sourceEntityId, rawBlockId: snapshot.id, revision: snapshot.revision, extractorId: "figma-frame", extractorVersion: "2" } };
  });
}
export async function fetchFigmaFile(fileKey: string, token: string, fetcher: FetchFigma = fetch): Promise<FigmaDocument> {
  const response = await fetcher(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}`, { headers: { "X-Figma-Token": token } });
  if (!response.ok) throw new Error(`Figma API failed with HTTP ${response.status}`);
  return response.json() as Promise<FigmaDocument>;
}
