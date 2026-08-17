export type SourceAgentDetailReadMode =
  | "append-cache"
  | "bounded-detail"
  | "detail-cache"
  | "indexed-detail";

export interface SourceAgentDetailMetadata {
  readMode: SourceAgentDetailReadMode;
}

const SOURCE_AGENT_DETAIL_METADATA = Symbol("deskcue.sourceAgentDetailMetadata");

type SourceAgentDetailWithMetadata = {
  [SOURCE_AGENT_DETAIL_METADATA]?: SourceAgentDetailMetadata;
};

export function markSourceAgentDetailMetadata<T extends object>(
  detail: T,
  metadata: SourceAgentDetailMetadata
): T {
  Object.defineProperty(detail, SOURCE_AGENT_DETAIL_METADATA, {
    configurable: true,
    enumerable: false,
    value: metadata
  });
  return detail;
}

function isSourceAgentDetailReadMode(value: unknown): value is SourceAgentDetailReadMode {
  return value === "append-cache" ||
    value === "bounded-detail" ||
    value === "detail-cache" ||
    value === "indexed-detail";
}

export function readSourceAgentDetailMetadata(
  detail: object | null | undefined
): SourceAgentDetailMetadata | null {
  const metadata = detail
    ? (detail as SourceAgentDetailWithMetadata)[SOURCE_AGENT_DETAIL_METADATA]
    : undefined;
  return metadata && isSourceAgentDetailReadMode(metadata.readMode) ? metadata : null;
}

export function copySourceAgentDetailMetadata<T extends object>(source: object, target: T): T {
  const metadata = readSourceAgentDetailMetadata(source);
  return metadata ? markSourceAgentDetailMetadata(target, metadata) : target;
}
