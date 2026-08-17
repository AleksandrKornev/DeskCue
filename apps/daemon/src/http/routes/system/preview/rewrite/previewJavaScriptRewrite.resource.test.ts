import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

const CHILD_TIMEOUT_MS = 20_000;
const RESOURCE_HEAP_LIMIT_MB = 160;
const SYNTHETIC_BUNDLE_BYTES = Math.floor(7.6 * 1024 * 1024);

function runResourceChild(args: string[]) {
  return new Promise<{ code: number | null; stderr: string; stdout: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    let stdout = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Timed out while measuring a large Preview JavaScript rewrite."));
    }, CHILD_TIMEOUT_MS);
    timeout.unref?.();
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stderr, stdout });
    });
  });
}

test("rewrites a large eval-wrapped Next bundle within a bounded child heap", async () => {
  const moduleUrl = new URL("./previewJavaScriptRewrite.ts", import.meta.url).href;
  const script = `
    import { rewritePreviewJavaScriptAssetLiterals } from ${JSON.stringify(moduleUrl)};
    const targetBytes = ${SYNTHETIC_BUNDLE_BYTES};
    const prefix = 'const icon="/icons/app.svg";';
    const punctuation = 'a.b=c(d,e);f[g]=h?i:j;';
    const decoded = (prefix + punctuation.repeat(Math.ceil(targetBytes / punctuation.length)))
      .slice(0, targetBytes - 16);
    const source = 'eval(' + JSON.stringify(decoded) + ');';
    const output = rewritePreviewJavaScriptAssetLiterals(
      Buffer.from(source),
      '/api/preview/sessions/resource-test/__deskcue_ticket__/resource-test'
    );
    if (!output.includes('/__deskcue_ticket__/resource-test/icons/app.svg')) process.exit(2);
    process.stdout.write(String(output.byteLength));
  `;
  const result = await runResourceChild([
    `--max-old-space-size=${RESOURCE_HEAP_LIMIT_MB}`,
    "--conditions=deskcue-source",
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    script
  ]);

  assert.equal(
    result.code,
    0,
    `Large Preview rewrite exceeded its bounded child heap. ${result.stderr.slice(-2_000)}`
  );
  assert.match(result.stdout, /^\d+$/);
});
