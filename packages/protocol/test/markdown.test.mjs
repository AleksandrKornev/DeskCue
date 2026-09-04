import assert from "node:assert/strict";
import test from "node:test";

import {
  getMarkdownAuthoredAssetSources,
  normalizeMarkdownLocalAssetPath,
  normalizeWindowsMarkdownTargets
} from "../dist/markdown.js";

test("normalizes encoded local Markdown paths exactly once", () => {
  assert.equal(
    normalizeMarkdownLocalAssetPath("D:/work/My%20Report.txt"),
    "D:/work/My Report.txt"
  );
  assert.equal(normalizeMarkdownLocalAssetPath("/tmp/My%20Report.txt"), "/tmp/My Report.txt");
  assert.equal(normalizeMarkdownLocalAssetPath("D:/work/My%2520Report.txt"), "D:/work/My%20Report.txt");
  assert.equal(normalizeMarkdownLocalAssetPath("D:/work/bad%ZZ.txt"), "D:/work/bad%ZZ.txt");
  assert.equal(normalizeMarkdownLocalAssetPath("https://example.com/My%20Report.txt"), null);
});

test("normalizes valid Windows Markdown destinations with balanced parentheses and titles", () => {
  assert.equal(
    normalizeWindowsMarkdownTargets(String.raw`[x](D:\docs\a(b).txt)`),
    "[x](</D:/docs/a(b).txt>)"
  );
  assert.equal(
    normalizeWindowsMarkdownTargets(String.raw`[x](D:\docs\a.txt "Readable title")`),
    "[x](</D:/docs/a.txt> \"Readable title\")"
  );
  assert.equal(
    normalizeWindowsMarkdownTargets(String.raw`[x](D:\docs\a.txt (Readable title))`),
    "[x](</D:/docs/a.txt> (Readable title))"
  );
});

test("does not reinterpret invalid or code-contained Windows targets as authored assets", () => {
  const invalid = String.raw`![cap](D:\shots\a (final).png)`;
  const inlineCode = `\`${String.raw`[x](D:\docs\a.txt)`}\``;
  const fencedCode = `\`\`\`text\n${String.raw`[x](D:\docs\a.txt)`}\n\`\`\``;
  const indentedCode = `    ${String.raw`[x](D:\docs\a.txt)`}`;

  assert.equal(normalizeWindowsMarkdownTargets(invalid), invalid);
  assert.equal(normalizeWindowsMarkdownTargets(inlineCode), inlineCode);
  assert.equal(normalizeWindowsMarkdownTargets(fencedCode), fencedCode);
  assert.equal(normalizeWindowsMarkdownTargets(indentedCode), indentedCode);
});

test("collects authored links and images but excludes code-contained lookalikes", () => {
  const markdown = [
    "![shot](D:/captures/shot.png)",
    "[report][report-ref]",
    "`[inline](D:/secrets/inline.txt)`",
    "```text",
    "[fenced](D:/secrets/fenced.txt)",
    "```",
    "[report-ref]: /tmp/My%20Report.txt"
  ].join("\n");

  assert.deepEqual(
    getMarkdownAuthoredAssetSources(markdown).sort(),
    ["/tmp/My%20Report.txt", "D:/captures/shot.png"].sort()
  );
});
