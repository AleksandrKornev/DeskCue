const CLOUD_REMOTE_ASSET_MAGIC = Buffer.from("DCA1", "ascii");
const CLOUD_REMOTE_ASSET_PREFIX_BYTES = 8;
const CLOUD_REMOTE_ASSET_MAX_HEADER_BYTES = 2 * 1024;

type CloudRemoteAssetHeaders = {
  acceptRanges?: string;
  contentDisposition?: string;
  contentRange?: string;
  contentType: string;
};

function readSafeHeader(value: string | null, maximumLength: number) {
  if (!value || value.length > maximumLength || /[\r\n\0]/u.test(value)) return;

  return value;
}

export function encodeCloudRemoteAssetEnvelope(response: Response, body: Buffer) {
  const headers: CloudRemoteAssetHeaders = {
    acceptRanges: readSafeHeader(response.headers.get("accept-ranges"), 32),
    contentType: readSafeHeader(response.headers.get("content-type"), 256) ??
      "application/octet-stream",
    contentDisposition: readSafeHeader(response.headers.get("content-disposition"), 1024),
    contentRange: readSafeHeader(response.headers.get("content-range"), 128)
  };

  const header = Buffer.from(JSON.stringify(headers), "utf8");

  if (header.byteLength > CLOUD_REMOTE_ASSET_MAX_HEADER_BYTES) {
    throw new Error("Cloud remote asset headers exceed the bounded envelope.");
  }

  const envelope = Buffer.allocUnsafe(CLOUD_REMOTE_ASSET_PREFIX_BYTES + header.byteLength + body.byteLength);

  CLOUD_REMOTE_ASSET_MAGIC.copy(envelope, 0);

  envelope.writeUInt32BE(header.byteLength, CLOUD_REMOTE_ASSET_MAGIC.byteLength);
  header.copy(envelope, CLOUD_REMOTE_ASSET_PREFIX_BYTES);
  body.copy(envelope, CLOUD_REMOTE_ASSET_PREFIX_BYTES + header.byteLength);
  return envelope;
}
