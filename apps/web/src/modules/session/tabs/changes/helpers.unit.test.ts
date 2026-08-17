import { describe, expect, it } from "vitest";

import {
  diffStatusLabel,
  mergeDiffReviewFiles,
  parseUnifiedDiff
} from "./helpers";

describe("parseUnifiedDiff", () => {
  it("splits files and keeps line numbers and stats bounded to each patch", () => {
    const files = parseUnifiedDiff([
      "diff --git a/src/app.ts b/src/app.ts",
      "index 123..456 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,2 +1,2 @@",
      "-const oldValue = true;",
      "+const newValue = true;",
      " export default newValue;",
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1 @@",
      "+export const ready = true;"
    ].join("\n"));

    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ additions: 1, deletions: 1, hasLineStats: true, path: "src/app.ts", status: "modified" });
    expect(files[0]?.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "deletion", oldLine: 1, text: "const oldValue = true;" }),
      expect.objectContaining({ kind: "addition", newLine: 1, text: "const newValue = true;" })
    ]));
    expect(files[1]).toMatchObject({ additions: 1, deletions: 0, path: "src/new.ts", status: "added" });
  });

  it("tracks native rename metadata", () => {
    const [file] = parseUnifiedDiff([
      "diff --git a/old-name.ts b/new-name.ts",
      "similarity index 100%",
      "rename from old-name.ts",
      "rename to new-name.ts"
    ].join("\n"));

    expect(file).toMatchObject({ path: "new-name.ts", previousPath: "old-name.ts", status: "renamed" });
  });

  it("does not invent zero line statistics when a dirty path has no patch", () => {
    const [file] = mergeDiffReviewFiles(["untracked-directory/"], []);

    expect(file).toMatchObject({
      additions: 0,
      deletions: 0,
      hasLineStats: false,
      path: "untracked-directory/",
      status: "unknown"
    });
    expect(diffStatusLabel(file.status)).toBe("?");
  });

  it("uses porcelain statuses when a changed path has no parsable patch", () => {
    const files = mergeDiffReviewFiles(
      ["modified.ts", "added.ts", "deleted.ts", "renamed.ts", "copied.ts", "conflicted.ts", "untracked.ts"],
      [],
      {
        "modified.ts": "M",
        "added.ts": "A",
        "deleted.ts": "D",
        "renamed.ts": "R",
        "copied.ts": "C",
        "conflicted.ts": "U",
        "untracked.ts": "?"
      }
    );

    expect(files.map((file) => diffStatusLabel(file.status))).toEqual([
      "M", "A", "D", "R", "C", "U", "?"
    ]);
  });

  it("keeps copy metadata from a native diff", () => {
    const [file] = parseUnifiedDiff([
      "diff --git a/source.ts b/copied.ts",
      "similarity index 100%",
      "copy from source.ts",
      "copy to copied.ts"
    ].join("\n"));

    expect(file).toMatchObject({ path: "copied.ts", previousPath: "source.ts", status: "copied" });
  });
});
