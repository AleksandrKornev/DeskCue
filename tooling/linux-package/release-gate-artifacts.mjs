import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { createLinuxPayloadManifest } from "./payload-lib.mjs";

export function sha256File(filePath) {
  const hash = createHash("sha256");
  const file = readFileSync(filePath);

  return hash.update(file).digest("hex");
}

export async function stageReleaseArtifacts(releaseRoot, version, artifactPaths) {
  const versionRoot = join(releaseRoot, "releases", "download", `v${version}`);

  await mkdir(versionRoot, { recursive: true });
  for (const artifactPath of artifactPaths) {
    await copyFile(artifactPath, join(versionRoot, basename(artifactPath)));
  }

  const checksums = artifactPaths
    .map((artifactPath) => `${sha256File(artifactPath)}  ${basename(artifactPath)}`)
    .join("\n");

  await writeFile(join(versionRoot, "SHA256SUMS"), `${checksums}\n`, "utf8");

  return versionRoot;
}

export async function rewritePayloadVersion(payloadRoot, version) {
  for (const appName of ["cli", "daemon", "host"]) {
    const manifestPath = join(payloadRoot, "app", "apps", appName, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    manifest.version = version;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
}

export async function breakPayloadHost(payloadRoot, executionMarkerPath) {
  const hostEntryPath = join(payloadRoot, "app", "apps", "host", "dist", "index.js");
  const hostEntry = await readFile(hostEntryPath, "utf8");
  const failurePrelude = [
    "import { writeFileSync as writeReleaseGateMarker } from \"node:fs\";",
    `writeReleaseGateMarker(${JSON.stringify(executionMarkerPath)}, "broken-host-started\\n", "utf8");`,
    "throw new Error(\"DeskCue release-gate induced Host startup failure\");"
  ].join("\n");

  await writeFile(
    hostEntryPath,
    `${failurePrelude}\n${hostEntry}`,
    "utf8"
  );
}

export function rebuildPayloadManifest(payloadRoot, version, architecture) {
  const manifest = JSON.parse(readFileSync(join(payloadRoot, "payload-manifest.json"), "utf8"));

  return createLinuxPayloadManifest(payloadRoot, {
    appVersion: version,
    architecture,
    nodeArchive: manifest.node.archive,
    nodeArchiveSha256: manifest.node.archiveSha256,
    nodeVersion: manifest.node.version
  });
}

export function writeUpdateManifest(filePath, { architecture, artifactPath, baseUrl, version }) {
  const artifactName = basename(artifactPath);
  const manifest = {
    artifacts: [{
      architecture,
      platform: "linux",
      sha256: sha256File(artifactPath),
      sizeBytes: statSync(artifactPath).size,
      url: `${baseUrl}/gate/${artifactName}`
    }],
    channel: "stable",
    publishedAt: new Date().toISOString(),
    schemaVersion: 1,
    version
  };

  writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return manifest;
}

export function streamFileResponse(response, filePath) {
  response.writeHead(200, { "content-length": statSync(filePath).size });
  createReadStream(filePath).pipe(response);
}
