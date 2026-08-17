import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("embed finalizer emits the exact checksum-bound React component manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "deskcue-embed-contract-"));
  try {
    const webRoot = join(root, "apps", "web");
    const scriptsRoot = join(webRoot, "scripts");
    const outputRoot = join(webRoot, "dist-embed");
    await mkdir(scriptsRoot, { recursive: true });
    await mkdir(outputRoot, { recursive: true });
    await copyFile(
      new URL("../../scripts/finalize-embed-build.mjs", import.meta.url),
      join(scriptsRoot, "finalize-embed-build.mjs")
    );
    await writeFile(join(webRoot, "package.json"), JSON.stringify({ version: "0.1.0" }));

    const outputs = new Map([
      ["index.js", "export const DeskCueRemoteApp = () => null;\n"],
      ["style.css", "[data-deskcue-remote-root] { display: block; }\n"]
    ]);
    for (const [path, source] of outputs) {
      await writeFile(join(outputRoot, path), source);
    }

    await execFileAsync(process.execPath, [join(scriptsRoot, "finalize-embed-build.mjs")], {
      env: { ...process.env, DESKCUE_WEB_ARTIFACT_VERSION: "2.4.0-contract" }
    });

    const manifest: unknown = JSON.parse(
      await readFile(join(outputRoot, "deskcue-embed.manifest.json"), "utf8")
    );
    assert.ok(typeof manifest === "object" && manifest !== null && !Array.isArray(manifest));
    const manifestRecord = manifest as Record<string, unknown>;
    assert.deepEqual(Object.keys(manifestRecord).sort(), [
      "artifact",
      "entrypoint",
      "files",
      "format",
      "reactPeerRange",
      "remoteProtocolVersion",
      "schemaVersion",
      "stylesheet",
      "version"
    ]);
    assert.equal(manifestRecord.schemaVersion, 2);
    assert.equal(manifestRecord.artifact, "deskcue-web-embed");
    assert.equal(manifestRecord.format, "react-component");
    assert.equal(manifestRecord.entrypoint, "index.js");
    assert.equal(manifestRecord.stylesheet, "style.css");
    assert.equal(manifestRecord.reactPeerRange, "^19.1.0");
    assert.equal(manifestRecord.remoteProtocolVersion, 1);
    assert.equal(manifestRecord.version, "2.4.0-contract");
    assert.deepEqual(manifestRecord.files, [...outputs].map(([path, source]) => ({
      path,
      size: Buffer.byteLength(source),
      sha256: createHash("sha256").update(source).digest("hex"),
      cache: "immutable"
    })));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
