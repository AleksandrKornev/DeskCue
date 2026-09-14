import { UpdateError } from "./errors.ts";

export const UPDATE_MANIFEST_SCHEMA_VERSION = 1;
export const UPDATE_SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type UpdateArchitecture = "arm64" | "x64";
export type UpdateChannel = "beta" | "stable";
export type UpdatePlatform = "win32";

export type UpdateArtifact = {
  architecture: UpdateArchitecture;
  platform: UpdatePlatform;
  sha256: string;
  sizeBytes: number;
  url: string;
};

export type UpdateManifest = {
  artifacts: UpdateArtifact[];
  channel: UpdateChannel;
  publishedAt: string;
  schemaVersion: typeof UPDATE_MANIFEST_SCHEMA_VERSION;
  version: string;
};

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const MANIFEST_KEYS = ["artifacts", "channel", "publishedAt", "schemaVersion", "version"];
const ARTIFACT_KEYS = ["architecture", "platform", "sha256", "sizeBytes", "url"];

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UpdateError("invalid_manifest", `${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, expected: string[], label: string) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();

  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new UpdateError("invalid_manifest", `${label} contains missing or unsupported fields.`);
  }
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new UpdateError("invalid_manifest", `${label} must be a non-empty string.`);
  }

  return value;
}

function parseVersion(value: string): ParsedVersion {
  const match = SEMVER_PATTERN.exec(value);

  if (!match) throw new UpdateError("invalid_manifest", `Invalid update version: ${value}.`);

  const prerelease = match[4]?.split(".") ?? [];
  const numericParts = match.slice(1, 4).map(Number);

  if (numericParts.some((part) => !Number.isSafeInteger(part))) {
    throw new UpdateError("invalid_manifest", `Invalid update version: ${value}.`);
  }

  for (const identifier of prerelease) {
    if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")) {
      throw new UpdateError("invalid_manifest", `Invalid update version: ${value}.`);
    }
  }

  return {
    major: numericParts[0]!,
    minor: numericParts[1]!,
    patch: numericParts[2]!,
    prerelease
  };
}

function comparePrerelease(left: string[], right: string[]) {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];

    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);

    if (leftNumeric && rightNumeric) return Number(leftPart) < Number(rightPart) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;

    return leftPart < rightPart ? -1 : 1;
  }

  return 0;
}

export function compareUpdateVersions(left: string, right: string) {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);

  for (const field of ["major", "minor", "patch"] as const) {
    if (parsedLeft[field] !== parsedRight[field]) {
      return parsedLeft[field] < parsedRight[field] ? -1 : 1;
    }
  }

  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}

export function isPrereleaseVersion(value: string) {
  return parseVersion(value).prerelease.length > 0;
}

export function parseUpdateArtifact(value: unknown): UpdateArtifact {
  const artifact = requireRecord(value, "Update artifact");

  assertExactKeys(artifact, ARTIFACT_KEYS, "Update artifact");

  if (artifact.platform !== "win32") {
    throw new UpdateError("invalid_manifest", "Update artifact platform must be win32.");
  }

  if (artifact.architecture !== "x64" && artifact.architecture !== "arm64") {
    throw new UpdateError("invalid_manifest", "Update artifact architecture is unsupported.");
  }

  if (!Number.isSafeInteger(artifact.sizeBytes) || (artifact.sizeBytes as number) <= 0) {
    throw new UpdateError("invalid_manifest", "Update artifact sizeBytes must be a positive integer.");
  }

  const sha256 = requireString(artifact.sha256, "Update artifact sha256");

  if (!UPDATE_SHA256_PATTERN.test(sha256)) {
    throw new UpdateError("invalid_manifest", "Update artifact sha256 must be lowercase hexadecimal.");
  }

  return {
    architecture: artifact.architecture,
    platform: artifact.platform,
    sha256,
    sizeBytes: artifact.sizeBytes as number,
    url: requireString(artifact.url, "Update artifact url")
  };
}

export function parseUpdateManifest(value: unknown): UpdateManifest {
  const manifest = requireRecord(value, "Update manifest");

  assertExactKeys(manifest, MANIFEST_KEYS, "Update manifest");

  if (manifest.schemaVersion !== UPDATE_MANIFEST_SCHEMA_VERSION) {
    throw new UpdateError("invalid_manifest", "Update manifest schemaVersion is unsupported.");
  }

  if (manifest.channel !== "stable" && manifest.channel !== "beta") {
    throw new UpdateError("invalid_manifest", "Update manifest channel is unsupported.");
  }

  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new UpdateError("invalid_manifest", "Update manifest artifacts must be a non-empty array.");
  }

  const version = requireString(manifest.version, "Update manifest version");

  parseVersion(version);

  if (manifest.channel === "stable" && isPrereleaseVersion(version)) {
    throw new UpdateError("invalid_manifest", "Stable update manifests cannot contain prerelease versions.");
  }

  const publishedAt = requireString(manifest.publishedAt, "Update manifest publishedAt");
  const publishedDate = new Date(publishedAt);

  if (!Number.isFinite(publishedDate.getTime()) || publishedDate.toISOString() !== publishedAt) {
    throw new UpdateError("invalid_manifest", "Update manifest publishedAt must be an ISO date-time.");
  }

  const artifacts = manifest.artifacts.map(parseUpdateArtifact);
  const targets = new Set<string>();

  for (const artifact of artifacts) {
    const target = `${artifact.platform}-${artifact.architecture}`;

    if (targets.has(target)) {
      throw new UpdateError("invalid_manifest", `Update manifest repeats artifact target ${target}.`);
    }

    targets.add(target);
  }

  return {
    artifacts,
    channel: manifest.channel,
    publishedAt,
    schemaVersion: UPDATE_MANIFEST_SCHEMA_VERSION,
    version
  };
}

export function selectUpdateArtifact(
  manifest: UpdateManifest,
  platform: UpdatePlatform,
  architecture: UpdateArchitecture
) {
  const artifact = manifest.artifacts.find(
    (candidate) => candidate.platform === platform && candidate.architecture === architecture
  );

  if (!artifact) {
    throw new UpdateError(
      "invalid_manifest",
      `Update manifest has no artifact for ${platform}-${architecture}.`
    );
  }

  return artifact;
}

export function parseUpdateManifestJson(value: string) {
  try {
    return parseUpdateManifest(JSON.parse(value));
  } catch (error) {
    if (error instanceof UpdateError) throw error;

    throw new UpdateError("invalid_manifest", "Update manifest is not valid JSON.", {
      cause: error
    });
  }
}
