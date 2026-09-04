import { describe, expect, it } from "vitest";

import {
  getAttachmentPreviewKind,
  getLocalAssetPreviewKind,
  isMarkdownLocalImagePath,
  isMarkdownVideoPath,
  normalizeMarkdownLocalAssetPath,
  shouldProbeLocalAssetAsText
} from "./attachments";

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

  it("decodes encoded local paths exactly once for rendering and deduplication", () => {
    expect(normalizeMarkdownLocalAssetPath("D:/work/My%20Report.txt")).toBe(
      "D:/work/My Report.txt"
    );

    expect(normalizeMarkdownLocalAssetPath("/tmp/My%20Report.txt")).toBe(
      "/tmp/My Report.txt"
    );

    expect(normalizeMarkdownLocalAssetPath("D:/work/My%2520Report.txt")).toBe(
      "D:/work/My%20Report.txt"
    );
  });

  it("removes URL query and fragment suffixes from local asset paths", () => {
    expect(normalizeMarkdownLocalAssetPath("D:/work/DeskCue/header.png?v=2#preview")).toBe(
      "D:/work/DeskCue/header.png"
    );
  });
});

describe("isMarkdownLocalImagePath", () => {
  it("requires a supported image extension and accepts URL suffixes", () => {
    expect(isMarkdownLocalImagePath("D:/work/DeskCue/header.png?v=2#preview")).toBe(true);
    expect(isMarkdownLocalImagePath("D:/work/DeskCue/blob")).toBe(false);
    expect(isMarkdownLocalImagePath("D:/work/DeskCue/.env.png")).toBe(false);
  });
});

describe("isMarkdownVideoPath", () => {
  it("keeps environment files out of the inline media renderer", () => {
    expect(isMarkdownVideoPath("D:/work/DeskCue/demo.mp4")).toBe(true);
    expect(isMarkdownVideoPath("D:/work/DeskCue/.env.mp4")).toBe(false);
  });
});

describe("getLocalAssetPreviewKind", () => {
  it("classifies browser-previewable local assets", () => {
    expect(getLocalAssetPreviewKind("artifacts/capture.webp")).toBe("image");
    expect(getLocalAssetPreviewKind("artifacts/demo.mp4")).toBe("video");
    expect(getLocalAssetPreviewKind("artifacts/note.ogg")).toBe("audio");
    expect(getLocalAssetPreviewKind("reports/audit.pdf")).toBe("pdf");
    expect(getLocalAssetPreviewKind("packages/protocol/package.json")).toBe("text");
    expect(getLocalAssetPreviewKind("D:/work/DeskCue/.gitignore")).toBe("text");
  });

  it("keeps binary extensions out of the preview surface and always classifies environment files as text", () => {
    expect(getLocalAssetPreviewKind("artifacts/archive.zip")).toBe("none");
    expect(getLocalAssetPreviewKind("artifacts/application.exe")).toBe("none");
    expect(getLocalAssetPreviewKind("secrets/.env")).toBe("text");
    expect(getLocalAssetPreviewKind("secrets/.env.production.json")).toBe("text");
    expect(getLocalAssetPreviewKind("secrets/.envrc")).toBe("text");
    expect(getLocalAssetPreviewKind("secrets/.env-local")).toBe("text");
    expect(getLocalAssetPreviewKind("secrets/.env.png")).toBe("text");
    expect(getLocalAssetPreviewKind("secrets/.env.mp4")).toBe("text");
    expect(getLocalAssetPreviewKind("secrets/.env.pdf")).toBe("text");
  });

  it("allows a bounded text probe for unfamiliar source and environment files but not known binaries", () => {
    expect(shouldProbeLocalAssetAsText("src/component.astro")).toBe(true);
    expect(shouldProbeLocalAssetAsText("secrets/.env.local")).toBe(true);
    expect(shouldProbeLocalAssetAsText("secrets/.envrc")).toBe(true);
    expect(shouldProbeLocalAssetAsText("secrets/.env-local")).toBe(true);
    expect(shouldProbeLocalAssetAsText("artifacts/archive.zip")).toBe(false);
  });
});

describe("getAttachmentPreviewKind", () => {
  it("uses the local path policy before the declared attachment kind", () => {
    expect(getAttachmentPreviewKind({
      kind: "local-image",
      label: "Environment",
      path: "secrets/.env.png",
      type: "attachment",
      url: null
    })).toBe("text");
  });
});
