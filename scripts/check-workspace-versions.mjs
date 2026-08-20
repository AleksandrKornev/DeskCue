import { access, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

async function readManifest(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function resolveWorkspaceManifestPaths(workspacePattern) {
  if (!workspacePattern.endsWith("/*")) {
    throw new Error(`Unsupported workspace pattern: ${workspacePattern}`);
  }
  const workspaceRoot = join(repositoryRoot, workspacePattern.slice(0, -2));
  const entries = await readdir(workspaceRoot, { withFileTypes: true });
  const manifestPaths = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(workspaceRoot, entry.name, "package.json");
    try {
      await access(manifestPath);
      manifestPaths.push(manifestPath);
    } catch {
      // Workspace glob semantics ignore directories without a package manifest.
    }
  }
  return manifestPaths;
}

const rootManifestPath = join(repositoryRoot, "package.json");
const rootManifest = await readManifest(rootManifestPath);
if (typeof rootManifest.version !== "string" || !SEMVER_PATTERN.test(rootManifest.version)) {
  throw new Error("Root package.json must contain a valid semantic version.");
}
if (!Array.isArray(rootManifest.workspaces)) {
  throw new Error("Root package.json must declare workspace patterns.");
}

const workspaceManifestPaths = (
  await Promise.all(rootManifest.workspaces.map(resolveWorkspaceManifestPaths))
).flat().sort();
const mismatches = [];
for (const manifestPath of workspaceManifestPaths) {
  const manifest = await readManifest(manifestPath);
  if (manifest.version !== rootManifest.version) {
    mismatches.push(
      `${relative(repositoryRoot, manifestPath)}: ${String(manifest.version)}`
    );
  }
}

if (mismatches.length > 0) {
  throw new Error(
    `Workspace versions must match ${rootManifest.version}:\n${mismatches.join("\n")}`
  );
}

console.log(
  `Verified DeskCue ${rootManifest.version} across ${workspaceManifestPaths.length + 1} manifests.`
);
