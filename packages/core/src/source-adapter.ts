import type { ChangeSet, RawBlockSnapshot, SourceType } from "./domain.js";

export interface SourceDescriptor {
  id: string;
  type: SourceType;
  displayName: string;
  configuration: Record<string, unknown>;
}

export interface SyncRequest {
  cursor?: string;
  mode: "PLAN" | "APPLY";
}

export interface SourceAdapter {
  readonly type: SourceType;
  sync(source: SourceDescriptor, request: SyncRequest): Promise<ChangeSet>;
}

export interface BlockSourceAdapter extends SourceAdapter {
  snapshot(source: SourceDescriptor): Promise<readonly RawBlockSnapshot[]>;
}
