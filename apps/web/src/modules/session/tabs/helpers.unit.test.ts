import { describe, expect, it } from "vitest";

import { filterUnifiedDiff } from "./helpers";

describe("filterUnifiedDiff", () => {
  it("keeps a visible quoted path after a hidden quoted block", () => {
    const filtered = filterUnifiedDiff([
      String.raw`diff --git "a/node_modules/hidden\t.txt" "b/node_modules/hidden\t.txt"`,
      "Binary files differ",
      String.raw`diff --git "a/\320\264\320\260\320\275\320\275\321\213\320\265.txt" "b/\320\264\320\260\320\275\320\275\321\213\320\265.txt"`,
      "@@ -1 +1 @@",
      "-before",
      "+after"
    ].join("\n"));

    expect(filtered).not.toContain("node_modules");
    expect(filtered).toContain(String.raw`\320\264\320\260\320\275\320\275\321\213\320\265.txt`);
    expect(filtered).toContain("+after");
  });
});
