import { describe, expect, it } from "vitest";

import type { TranscriptPart } from "@deskcue/protocol";

import {
  getRenderableTranscriptParts,
  orderAttachmentsBeforeMarkdown
} from "./transcriptParts";

function localImage(path: string): Extract<TranscriptPart, { type: "attachment" }> {
  return {
    kind: "local-image",
    label: "Screenshot",
    path,
    type: "attachment",
    url: null
  };
}

describe("getRenderableTranscriptParts", () => {
  it("suppresses singular and plural compact activity placeholders", () => {
    const compactStatuses: TranscriptPart[] = [
      {
        detail: "1 tool entry loads when this activity is opened",
        label: "Tool events",
        type: "status"
      },
      {
        detail: "3 detail entries load when this activity is opened",
        label: "Details",
        type: "status"
      }
    ];

    expect(getRenderableTranscriptParts(compactStatuses)).toEqual([]);
  });

  it("preserves ordinary status content with similar wording", () => {
    const status: TranscriptPart = {
      detail: "1 tool entry loads when this panel is opened",
      label: "Tool events",
      type: "status"
    };

    expect(getRenderableTranscriptParts([status])).toEqual([status]);
  });

  it("suppresses a local attachment already rendered as an inline Markdown image", () => {
    const markdown = {
      text: "![Header](D:\\work\\DeskCueWorkspace\\header.png)",
      type: "markdown" as const
    };

    expect(getRenderableTranscriptParts([
      markdown,
      localImage("d:/work/DeskCueWorkspace/header.png")
    ])).toEqual([markdown]);
  });

  it("resolves reference-style Markdown images before suppressing the matching attachment", () => {
    const markdown = {
      text: "![Header][capture]\n\n[capture]: D:/work/DeskCueWorkspace/header.png",
      type: "markdown" as const
    };

    expect(getRenderableTranscriptParts([
      markdown,
      localImage("D:/work/DeskCueWorkspace/header.png")
    ])).toEqual([markdown]);
  });

  it("matches an encoded Markdown image path to its decoded local attachment", () => {
    const markdown = {
      text: "![Header](<D:/work/DeskCueWorkspace/header%20final.png>)",
      type: "markdown" as const
    };

    expect(getRenderableTranscriptParts([
      markdown,
      localImage("D:/work/DeskCueWorkspace/header final.png")
    ])).toEqual([markdown]);
  });

  it("matches a supported inline image with a URL suffix", () => {
    const markdown = {
      text: "![Header](D:/work/DeskCueWorkspace/header.png?v=2#preview)",
      type: "markdown" as const
    };

    expect(getRenderableTranscriptParts([
      markdown,
      localImage("D:/work/DeskCueWorkspace/header.png")
    ])).toEqual([markdown]);
  });

  it("preserves authored non-image Markdown semantics without a duplicate attachment", () => {
    const markdown = {
      text: "![Header](D:/work/DeskCueWorkspace/blob)",
      type: "markdown" as const
    };

    const attachment = localImage("D:/work/DeskCueWorkspace/blob");

    expect(getRenderableTranscriptParts([markdown, attachment])).toEqual([markdown]);
  });

  it("does not duplicate an attachment already represented by a Markdown link", () => {
    const linkedMarkdown = {
      text: "[Header](D:/work/DeskCueWorkspace/header.png)",
      type: "markdown" as const
    };

    const attachment = localImage("D:/work/DeskCueWorkspace/header.png");

    expect(getRenderableTranscriptParts([linkedMarkdown, attachment]))
      .toEqual([linkedMarkdown]);
    expect(getRenderableTranscriptParts([attachment])).toEqual([attachment]);
  });

  it("resolves reference-style file links before suppressing the matching attachment", () => {
    const markdown = {
      text: "[Demo video][capture]\n\n[capture]: D:/work/DeskCueWorkspace/demo.mp4",
      type: "markdown" as const
    };

    const attachment = {
      kind: "local-file" as const,
      label: "Demo video",
      path: "D:/work/DeskCueWorkspace/demo.mp4",
      type: "attachment" as const,
      url: null
    };

    expect(getRenderableTranscriptParts([markdown, attachment])).toEqual([markdown]);
  });

  it("preserves another image attachment that is not represented inline", () => {
    const markdown = {
      text: "![Header](D:/work/DeskCueWorkspace/header.png)",
      type: "markdown" as const
    };

    const otherAttachment = localImage("D:/work/DeskCueWorkspace/details.png");

    expect(getRenderableTranscriptParts([markdown, otherAttachment]))
      .toEqual([markdown, otherAttachment]);
  });

  it("suppresses a remote attachment already represented by authored Markdown", () => {
    const markdown = {
      text: "![Remote run](https://example.com/media/run.webp)",
      type: "markdown" as const
    };

    const attachment = {
      kind: "image" as const,
      label: "Remote run",
      path: null,
      type: "attachment" as const,
      url: "https://example.com/media/run.webp"
    };

    expect(getRenderableTranscriptParts([markdown, attachment])).toEqual([markdown]);
  });
});

describe("orderAttachmentsBeforeMarkdown", () => {
  it("moves a trailing attachment run before the user prompt", () => {
    const prompt = { text: "Review these", type: "markdown" as const };
    const firstAttachment = localImage("C:/tmp/first.png");
    const secondAttachment = localImage("C:/tmp/second.png");

    expect(orderAttachmentsBeforeMarkdown([
      prompt,
      firstAttachment,
      secondAttachment
    ])).toEqual([
      firstAttachment,
      secondAttachment,
      prompt
    ]);
  });

  it("preserves authored order when attachments and Markdown are interleaved", () => {
    const firstMarkdown = { text: "First", type: "markdown" as const };
    const firstAttachment = localImage("C:/tmp/first.png");
    const secondMarkdown = { text: "Second", type: "markdown" as const };
    const secondAttachment = localImage("C:/tmp/second.png");
    const parts = [
      firstMarkdown,
      firstAttachment,
      secondMarkdown,
      secondAttachment
    ];

    expect(orderAttachmentsBeforeMarkdown(parts)).toEqual(parts);
  });

  it("preserves authored order when primary content is separated by status", () => {
    const parts: TranscriptPart[] = [
      { text: "First", type: "markdown" },
      localImage("C:/tmp/first.png"),
      { detail: "Still working", label: "Running", type: "status" },
      { text: "Second", type: "markdown" },
      localImage("C:/tmp/second.png")
    ];

    expect(orderAttachmentsBeforeMarkdown(parts)).toEqual(parts);
  });
});
