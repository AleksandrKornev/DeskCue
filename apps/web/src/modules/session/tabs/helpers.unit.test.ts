import { describe, expect, it } from "vitest";

import { MAX_VISIBLE_DIFF_CHARS } from "./constants";
import { filterUnifiedDiff, trimUnifiedDiff } from "./helpers";

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

describe("trimUnifiedDiff", () => {
  it("preserves source truncation truth after hidden blocks are filtered out", () => {
    expect(trimUnifiedDiff("", true)).toEqual({
      text: "",
      wasTrimmed: true
    });
  });

  it("does not label a fully retained visible suffix truncated because a hidden block was large", () => {
    expect(trimUnifiedDiff("+fully retained", false)).toEqual({
      text: "+fully retained",
      wasTrimmed: false
    });
  });

  it("does not split a Unicode surrogate pair at the visible boundary", () => {
    const diff = `${"x".repeat(MAX_VISIBLE_DIFF_CHARS - 1)}😀tail`;
    const result = trimUnifiedDiff(diff);
    const visiblePrefix = result.text.split("\n\n...diff truncated...")[0] ?? "";

    expect(result.wasTrimmed).toBe(true);
    expect(visiblePrefix).toBe("x".repeat(MAX_VISIBLE_DIFF_CHARS - 1));
    expect(visiblePrefix.at(-1)?.charCodeAt(0)).not.toBeGreaterThanOrEqual(0xD800);
    expect(result.text).toContain("...diff truncated...");
  });
});
