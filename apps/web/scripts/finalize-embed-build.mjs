import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

async function listFiles(root) {
  const pending = [root];
  const files = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}${sep}${entry.name}`;
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile() && entry.name !== "deskcue-embed.manifest.json") {
        files.push(relative(root, path).split(sep).join("/"));
      }
    }
  }
  return files.sort();
}

const outputDirectory = new URL("../dist-embed/", import.meta.url);
const outputPath = fileURLToPath(outputDirectory);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
);
const version = process.env.DESKCUE_WEB_ARTIFACT_VERSION?.trim() || packageJson.version;
if (!/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/u.test(version)) {
  throw new Error("DESKCUE_WEB_ARTIFACT_VERSION is invalid.");
}

for (const requiredPath of ["index.js", "style.css"]) {
  const file = await stat(new URL(requiredPath, outputDirectory));
  if (!file.isFile()) {
    throw new Error(`DeskCue embed output is missing ${requiredPath}.`);
  }
}

const paths = await listFiles(outputPath);
const files = await Promise.all(paths.map(async (path) => {
  const bytes = await readFile(`${outputPath}${sep}${path.split("/").join(sep)}`);
  return {
    path,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    cache: "immutable"
  };
}));

await writeFile(
  new URL("deskcue-embed.manifest.json", outputDirectory),
  `${JSON.stringify({
    schemaVersion: 2,
    artifact: "deskcue-web-embed",
    version,
    format: "react-component",
    entrypoint: "index.js",
    stylesheet: "style.css",
    remoteProtocolVersion: 1,
    reactPeerRange: "^19.1.0",
    files
  }, null, 2)}\n`,
  "utf8"
);
