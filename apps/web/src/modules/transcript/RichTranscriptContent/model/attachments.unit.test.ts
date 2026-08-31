import { describe, expect, it } from "vitest";

import { normalizeMarkdownLocalAssetPath } from "./attachments";

describe("normalizeMarkdownLocalAssetPath", () => {
  it("removes Windows source positions before requesting a local asset", () => {
    expect(normalizeMarkdownLocalAssetPath("D:/work/DeskCue/App.tsx:49")).toBe(
      "D:/work/DeskCue/App.tsx"
    );

    expect(normalizeMarkdownLocalAssetPath("/D:/work/DeskCue/App.tsx:49:7")).toBe(
      "D:/work/DeskCue/App.tsx"
    );

    expect(normalizeMarkdownLocalAssetPath("file:///D:/work/DeskCue/App.tsx:49")).toBe(
      "D:/work/DeskCue/App.tsx"
    );
  });

  it("preserves ordinary Windows paths and POSIX paths with colons", () => {
    expect(normalizeMarkdownLocalAssetPath("D:/work/DeskCue/report.txt")).toBe(
      "D:/work/DeskCue/report.txt"
    );

    expect(normalizeMarkdownLocalAssetPath("/tmp/report.txt:49")).toBe("/tmp/report.txt:49");
  });

  it("keeps malformed file URL escapes render-safe", () => {
    expect(normalizeMarkdownLocalAssetPath("file:///C:/bad%ZZ.txt")).toBe("C:/bad%ZZ.txt");
  });
});
