import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TranscriptPart } from "@deskcue/protocol";
import { assetsApi } from "@api/endpoint/assets/endpoints";

import { groupSecondaryTranscriptParts } from "./helpers";
import { RichTranscriptContent } from "./RichTranscriptContent";

function toolCall(index: number): TranscriptPart {
  return {
    argumentsText: `argument-${index}`,
    namespace: "test",
    toolName: `tool-${index}`,
    type: "tool_call"
  };
}

function toolResult(index: number): TranscriptPart {
  return {
    status: "completed",
    text: `result-${index}`,
    toolName: `tool-${index}`,
    type: "tool_result"
  };
}

function localAttachment(
  path: string,
  kind: "local-file" | "local-image" = "local-file"
): Extract<TranscriptPart, { type: "attachment" }> {
  return {
    kind,
    label: path.split("/").pop() ?? path,
    path,
    type: "attachment",
    url: null
  };
}

describe("RichTranscriptContent", () => {
  it("asks whether to open or download a local Markdown link", () => {
    render(
      <RichTranscriptContent
        entry={{
          parts: [{
            type: "markdown",
            text: "[DESKCUE_CHANGE_VALIDATION.md](</D:/work/DeskCueWorkspace/DESKCUE_CHANGE_VALIDATION.md>)"
          }],
          text: ""
        }}
      />
    );

    fireEvent.click(screen.getByRole("link", { name: "DESKCUE_CHANGE_VALIDATION.md" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
  });

  it("recovers a raw Windows Markdown target emitted by a local agent", () => {
    render(
      <RichTranscriptContent
        entry={{
          parts: [{
            type: "markdown",
            text: "[mobile evidence](D:\\work\\DeskCueWorkspace\\mobile-evidence.png)"
          }],
          text: ""
        }}
      />
    );

    const assetLink = screen.getByRole("link", { name: "mobile evidence" });

    expect(assetLink).toHaveAttribute(
      "title",
      "D:/work/DeskCueWorkspace/mobile-evidence.png"
    );

    fireEvent.click(assetLink);
    expect(screen.getByRole("dialog", { name: "mobile-evidence.png" })).toBeInTheDocument();
  });

  it("keeps a Markdown title out of the requested Windows asset path", () => {
    render(
      <RichTranscriptContent
        entry={{
          parts: [{
            type: "markdown",
            text: "[report](D:\\work\\DeskCueWorkspace\\report.txt \"Readable title\")"
          }],
          text: ""
        }}
      />
    );

    expect(screen.getByRole("link", { name: "report" })).toHaveAttribute(
      "title",
      "D:/work/DeskCueWorkspace/report.txt"
    );
  });

  it("leaves escaped Windows link examples as prose", () => {
    render(
      <RichTranscriptContent
        entry={{
          parts: [{
            type: "markdown",
            text: "\\[literal](D:\\work\\DeskCueWorkspace\\literal.txt)"
          }],
          text: ""
        }}
      />
    );

    expect(screen.queryByRole("button", { name: "literal" })).not.toBeInTheDocument();
    expect(screen.getByText(/D:\\work\\DeskCueWorkspace\\literal\.txt/u)).toBeInTheDocument();
  });

  it("keeps an open local-asset dialog mounted across transcript refreshes", () => {
    const entry = {
      parts: [{
        type: "markdown" as const,
        text: "[report](D:\\work\\DeskCueWorkspace\\report.txt)"
      }],
      text: ""
    };

    const view = render(
      <RichTranscriptContent
        assetContext={{ managedSessionId: "managed-1" }}
        entry={entry}
      />
    );

    fireEvent.click(screen.getByRole("link", { name: "report" }));
    expect(screen.getByRole("dialog", { name: "report.txt" })).toBeInTheDocument();

    view.rerender(
      <RichTranscriptContent
        assetContext={{ managedSessionId: "managed-1" }}
        entry={{ ...entry, parts: [...entry.parts] }}
      />
    );

    expect(screen.getByRole("dialog", { name: "report.txt" })).toBeInTheDocument();
  });

  it("renders local video Markdown embeds inline without autoplay", async () => {
    const buildFileUrl = vi.spyOn(assetsApi, "buildFileUrl")
      .mockReturnValueOnce("/api/assets/file?path=video");

    const { container } = render(
      <RichTranscriptContent
        assetContext={{ managedSessionId: "managed-1" }}
        entry={{
          parts: [{
            type: "markdown",
            text: "![DeskCue E2E](D:/work/review/deskcue%20e2e.mp4)"
          }],
          text: ""
        }}
      />
    );

    await waitFor(() => expect(container.querySelector("video")).toBeInTheDocument());
    const video = container.querySelector("video");

    expect(video).toHaveAttribute("aria-label", "DeskCue E2E");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video).not.toHaveAttribute("autoplay");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(buildFileUrl).toHaveBeenCalledWith(
      "D:/work/review/deskcue e2e.mp4",
      { context: { managedSessionId: "managed-1" } }
    );

    buildFileUrl.mockRestore();
  });

  it.each([".env.png", ".env.mp4"])(
    "keeps a Markdown environment embed %s in the bounded text sheet",
    async (fileName) => {
      const getTicketBlob = vi.spyOn(assetsApi, "getTicketBlob")
        .mockResolvedValueOnce(new Blob(["APP_MODE=local"], { type: "text/plain" }));
      const createLocalAssetLink = vi.spyOn(assetsApi, "createLocalAssetLink");
      const { container } = render(
        <RichTranscriptContent
          assetContext={{ managedSessionId: "managed-1" }}
          entry={{
            parts: [{
              type: "markdown",
              text: `![Environment](D:/work/review/${fileName})`
            }],
            text: ""
          }}
        />
      );

      expect(container.querySelector("img, video")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("link", { name: "Environment" }));

      expect(await screen.findByLabelText(`${fileName} contents`))
        .toHaveTextContent("APP_MODE=local");
      expect(getTicketBlob).toHaveBeenCalledWith(
        `D:/work/review/${fileName}`,
        fileName,
        expect.objectContaining({ kind: "file", maxBytes: 2 * 1024 * 1024 })
      );

      expect(createLocalAssetLink).not.toHaveBeenCalled();

      getTicketBlob.mockRestore();
      createLocalAssetLink.mockRestore();
    }
  );

  it("keeps an authored video link as a link instead of an inline player", () => {
    const { container } = render(
      <RichTranscriptContent
        entry={{
          parts: [{
            type: "markdown",
            text: "[Continuous run](D:/work/review/deskcue-e2e.mp4)"
          }],
          text: ""
        }}
      />
    );

    expect(screen.getByRole("link", { name: "Continuous run" })).toBeInTheDocument();
    expect(container.querySelector("video")).not.toBeInTheDocument();
  });

  it("renders an external video embed with controls and no autoplay", () => {
    const { container } = render(
      <RichTranscriptContent
        entry={{
          parts: [{
            type: "markdown",
            text: "![Remote run](https://example.com/deskcue.webm)"
          }],
          text: ""
        }}
      />
    );
    const video = container.querySelector("video");

    expect(video).toHaveAttribute("src", "https://example.com/deskcue.webm");
    expect(video).toHaveAttribute("controls");
    expect(video).not.toHaveAttribute("autoplay");
  });

  it("groups consecutive user attachments into one selectable gallery", () => {
    render(
      <RichTranscriptContent
        entry={{
          parts: [
            {
              kind: "local-file",
              label: "Video",
              path: "D:/work/review/run.mp4",
              type: "attachment",
              url: null
            },
            {
              kind: "local-file",
              label: "Report",
              path: "D:/work/review/report.pdf",
              type: "attachment",
              url: null
            }
          ],
          role: "user",
          text: ""
        }}
      />
    );

    expect(screen.getByText("Assets")).toBeInTheDocument();
    expect(screen.getByText("2 files attached")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    const firstSelector = screen.getByRole("radio", {
      name: "run.mp4, attachment 1 of 2"
    });
    const secondSelector = screen.getByRole("radio", {
      name: "report.pdf, attachment 2 of 2"
    });

    const selectorGroup = screen.getByRole("radiogroup", { name: "Message assets" });

    expect(selectorGroup).toHaveTextContent("MP4");
    expect(selectorGroup).toHaveTextContent("PDF");
    expect(firstSelector).toHaveAttribute(
      "aria-checked",
      "true"
    );

    expect(firstSelector).toHaveAttribute("tabindex", "0");
    expect(secondSelector).toHaveAttribute("tabindex", "-1");

    expect(screen.getByText("run.mp4")).toBeInTheDocument();
    expect(screen.queryByText("report.pdf")).not.toBeInTheDocument();

    firstSelector.focus();
    fireEvent.keyDown(firstSelector, { key: "ArrowRight" });

    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(secondSelector).toHaveAttribute(
      "aria-checked",
      "true"
    );

    expect(secondSelector).toHaveFocus();

    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.queryByText("run.mp4")).not.toBeInTheDocument();

    fireEvent.keyDown(secondSelector, { key: "Home" });

    expect(firstSelector).toHaveFocus();
    expect(firstSelector).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(firstSelector, { key: "End" });

    expect(secondSelector).toHaveFocus();
    expect(secondSelector).toHaveAttribute("aria-checked", "true");
  });

  it("preserves interleaved user Markdown and attachment order", () => {
    const { container } = render(
      <RichTranscriptContent
        entry={{
          parts: [
            { text: "First note", type: "markdown" },
            localAttachment("D:/work/review/first.png"),
            { text: "Second note", type: "markdown" },
            localAttachment("D:/work/review/second.png")
          ],
          role: "user",
          text: ""
        }}
      />
    );
    const content = container.textContent ?? "";

    expect(content.indexOf("First note")).toBeLessThan(content.indexOf("first.png"));
    expect(content.indexOf("first.png")).toBeLessThan(content.indexOf("Second note"));
    expect(content.indexOf("Second note")).toBeLessThan(content.indexOf("second.png"));
    expect(screen.queryByText("Assets")).not.toBeInTheDocument();
  });

  it("preserves the selected user attachment by identity across live list changes", () => {
    const renderEntry = (paths: string[]) => ({
      parts: paths.map((path) => localAttachment(path)),
      role: "user" as const,
      text: ""
    });
    const view = render(
      <RichTranscriptContent entry={renderEntry(["D:/a.png", "D:/b.png", "D:/c.png"])} />
    );

    fireEvent.click(screen.getByRole("radio", {
      name: "b.png, attachment 2 of 3"
    }));
    view.rerender(<RichTranscriptContent entry={renderEntry(["D:/b.png", "D:/c.png"])} />);

    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByRole("radio", {
      name: "b.png, attachment 1 of 2"
    })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("b.png")).toBeInTheDocument();

    view.rerender(<RichTranscriptContent entry={renderEntry(["D:/c.png", "D:/b.png"])} />);

    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByRole("radio", {
      name: "b.png, attachment 2 of 2"
    })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("b.png")).toBeInTheDocument();

    view.rerender(<RichTranscriptContent entry={renderEntry(["D:/c.png", "D:/a.png"])} />);

    expect(screen.getByRole("radio", {
      name: "c.png, attachment 1 of 2"
    })).toHaveAttribute("aria-checked", "true");

    view.rerender(
      <RichTranscriptContent entry={renderEntry(["D:/b.png", "D:/c.png", "D:/a.png"])} />
    );

    expect(screen.getByRole("radio", {
      name: "c.png, attachment 2 of 3"
    })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("c.png")).toBeInTheDocument();
  });

  it("keeps selection when live hydration changes presentation fields", () => {
    const first = localAttachment("D:/first.txt");
    const second = localAttachment("D:/second.txt");
    const view = render(
      <RichTranscriptContent entry={{ parts: [first, second], role: "user", text: "" }} />
    );

    fireEvent.click(screen.getByRole("radio", {
      name: "second.txt, attachment 2 of 2"
    }));
    view.rerender(
      <RichTranscriptContent
        entry={{
          parts: [first, { ...second, kind: "file", label: "Hydrated label" }],
          role: "user",
          text: ""
        }}
      />
    );

    expect(screen.getByRole("radio", {
      name: "second.txt, attachment 2 of 2"
    })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("second.txt")).toBeInTheDocument();
  });

  it("restores keyboard focus when the selected attachment disappears", () => {
    const renderEntry = (paths: string[]) => ({
      parts: paths.map((path) => localAttachment(path)),
      role: "user" as const,
      text: ""
    });
    const view = render(
      <RichTranscriptContent entry={renderEntry(["D:/a.txt", "D:/b.txt"])} />
    );
    const secondSelector = screen.getByRole("radio", {
      name: "b.txt, attachment 2 of 2"
    });

    fireEvent.click(secondSelector);
    secondSelector.focus();
    view.rerender(<RichTranscriptContent entry={renderEntry(["D:/a.txt", "D:/c.txt"])} />);

    expect(screen.getByRole("radio", {
      name: "a.txt, attachment 1 of 2"
    })).toHaveFocus();
  });

  it("keeps the carousel and focus when a live attachment group shrinks to one", () => {
    const renderEntry = (paths: string[]) => ({
      parts: paths.map((path) => localAttachment(path)),
      role: "user" as const,
      text: ""
    });
    const view = render(
      <RichTranscriptContent entry={renderEntry(["D:/a.txt", "D:/b.txt"])} />
    );
    const secondSelector = screen.getByRole("radio", {
      name: "b.txt, attachment 2 of 2"
    });

    fireEvent.click(secondSelector);
    secondSelector.focus();
    view.rerender(<RichTranscriptContent entry={renderEntry(["D:/a.txt"])} />);

    expect(screen.getByText("1 file attached")).toBeInTheDocument();
    expect(screen.getByRole("radio", {
      name: "a.txt, attachment 1 of 1"
    })).toHaveFocus();
    expect(screen.getByText("a.txt")).toBeInTheDocument();
  });

  it("falls back to an equivalent duplicate before an unrelated attachment", () => {
    const unrelated = localAttachment("D:/x.txt");
    const duplicate = localAttachment("D:/a.txt");
    const view = render(
      <RichTranscriptContent
        entry={{ parts: [unrelated, duplicate, duplicate], role: "user", text: "" }}
      />
    );

    fireEvent.click(screen.getByRole("radio", {
      name: "a.txt, attachment 3 of 3"
    }));
    view.rerender(
      <RichTranscriptContent
        entry={{ parts: [unrelated, duplicate], role: "user", text: "" }}
      />
    );

    expect(screen.getByRole("radio", {
      name: "a.txt, attachment 2 of 2"
    })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("a.txt")).toBeInTheDocument();
  });

  it("keeps a single user attachment standalone until a carousel is needed", () => {
    render(
      <RichTranscriptContent
        entry={{ parts: [localAttachment("D:/only.txt")], role: "user", text: "" }}
      />
    );

    expect(screen.getByText("only.txt")).toBeInTheDocument();
    expect(screen.queryByText("Assets")).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("disambiguates equal attachment basenames by position and full-path title", () => {
    render(
      <RichTranscriptContent
        entry={{
          parts: [
            localAttachment("D:/first/screenshot.png"),
            localAttachment("D:/second/screenshot.png")
          ],
          role: "user",
          text: ""
        }}
      />
    );

    expect(screen.getByRole("radio", {
      name: "screenshot.png, attachment 1 of 2"
    })).toHaveAttribute("title", "D:/first/screenshot.png");
    expect(screen.getByRole("radio", {
      name: "screenshot.png, attachment 2 of 2"
    })).toHaveAttribute("title", "D:/second/screenshot.png");
  });

  it("keeps workspace scope on grouped local-image thumbnail requests", async () => {
    const getTicketBlob = vi.spyOn(assetsApi, "getTicketBlob")
      .mockImplementation(() => new Promise<Blob>(() => undefined));

    render(
      <RichTranscriptContent
        assetContext={{ workspaceId: "workspace-1" }}
        entry={{
          parts: [
            localAttachment("D:/workspace/one.png", "local-image"),
            localAttachment("D:/workspace/two.png", "local-image")
          ],
          role: "user",
          text: ""
        }}
      />
    );

    await waitFor(() => expect(getTicketBlob).toHaveBeenCalledWith(
      "D:/workspace/two.png",
      "two.png",
      {
        context: {
          agentSessionId: undefined,
          managedSessionId: undefined,
          workspaceId: "workspace-1"
        },
        kind: "local_image"
      }
    ));

    getTicketBlob.mockRestore();
  });

  it("keeps assistant attachments standalone without an asset gallery", () => {
    render(
      <RichTranscriptContent
        entry={{
          parts: [
            {
              kind: "local-file",
              label: "Video",
              path: "D:/work/review/run.mp4",
              type: "attachment",
              url: null
            },
            {
              kind: "local-file",
              label: "Report",
              path: "D:/work/review/report.pdf",
              type: "attachment",
              url: null
            }
          ],
          role: "assistant",
          text: ""
        }}
      />
    );

    expect(screen.getAllByText("run.mp4")).toHaveLength(1);
    expect(screen.getAllByText("report.pdf")).toHaveLength(1);
    expect(screen.queryByText("Assets")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("does not nest local asset buttons for a linked non-image embed", () => {
    render(
      <RichTranscriptContent
        entry={{
          parts: [{
            type: "markdown",
            text: "[![video](D:\\media\\clip.mp4)](D:\\reports\\index.txt)"
          }],
          text: ""
        }}
      />
    );

    const assetLinks = screen.getAllByRole("link", { name: "video" });

    expect(assetLinks).toHaveLength(1);
    expect(assetLinks[0]).toHaveAttribute("title", "D:/reports/index.txt");
    expect(assetLinks[0]?.querySelector("a, button")).toBeNull();
  });

  it("keeps large tool groups bounded until the user asks for every detail", () => {
    const parts = Array.from({ length: 12 }, (_, index) => toolCall(index + 1));

    render(
      <RichTranscriptContent
        collapseSecondaryParts
        entry={{ parts, text: "" }}
      />
    );

    fireEvent.click(screen.getByText("Tools (12)"));

    expect(screen.getAllByText("Tool call")).toHaveLength(8);
    expect(screen.getByText("Showing the latest 8 of 12 events · 8 details")).toBeInTheDocument();
    expect(screen.queryByText("test.tool-1")).not.toBeInTheDocument();
    expect(screen.getByText("test.tool-12")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all 12 details" }));
    expect(screen.getAllByText("Tool call")).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Show latest 8 events" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Show latest 8 events" }));
    expect(screen.getAllByText("Tool call")).toHaveLength(8);
    expect(screen.getByText("Showing the latest 8 of 12 events · 8 details")).toBeInTheDocument();
  });

  it("keeps call/result pairs intact when limiting mixed tool activity", () => {
    const parts: TranscriptPart[] = [];

    for (let index = 1; index <= 10; index += 1) {
      parts.push(toolCall(index));
      if (index === 6) parts.push({ detail: "still running", label: "Progress", type: "status" });
      parts.push(toolResult(index));
    }

    parts.push(toolCall(11));

    render(
      <RichTranscriptContent
        collapseSecondaryParts
        entry={{ parts, text: "" }}
      />
    );

    fireEvent.click(screen.getByText("Tools and details (22)"));

    expect(screen.getAllByText("Tool call")).toHaveLength(8);
    expect(screen.getAllByText("Tool result")).toHaveLength(7);
    expect(screen.queryByText("test.tool-3")).not.toBeInTheDocument();
    expect(screen.getByText("test.tool-4")).toBeInTheDocument();
    expect(screen.getByText("test.tool-11")).toBeInTheDocument();
    expect(screen.getByText("Showing the latest 8 of 11 events · 16 details"))
      .toBeInTheDocument();
    expect(screen.getAllByText(/Tool call|Tool result/)[0]).toHaveTextContent("Tool call");
  });

  it("keeps the latest out-of-order result visible with its original call", () => {
    const parts: TranscriptPart[] = Array.from({ length: 10 }, (_, index) => toolCall(index + 1));

    parts.push(toolResult(1));

    render(
      <RichTranscriptContent
        collapseSecondaryParts
        entry={{ parts, text: "" }}
      />
    );

    fireEvent.click(screen.getByText("Tools (11)"));

    expect(screen.getByText("test.tool-1")).toBeInTheDocument();
    expect(screen.getByText("result-1")).toBeInTheDocument();
    expect(screen.queryByText("test.tool-2")).not.toBeInTheDocument();
    expect(screen.queryByText("test.tool-3")).not.toBeInTheDocument();
    expect(screen.getByText("Showing the latest 8 of 10 events · 9 details"))
      .toBeInTheDocument();
  });
});

describe("groupSecondaryTranscriptParts", () => {
  it("matches interleaved parallel results to the unique pending tool name", () => {
    const callA = toolCall(1);
    const callB = toolCall(2);
    const resultA = toolResult(1);
    const resultB = toolResult(2);

    expect(groupSecondaryTranscriptParts([callA, callB, resultA, resultB])).toEqual([
      [callA, resultA],
      [callB, resultB]
    ]);
  });

  it("keeps ambiguous same-name results separate instead of guessing", () => {
    const callA = toolCall(1);
    const callB = { ...toolCall(2), toolName: "tool-1" };
    const resultA = toolResult(1);
    const resultB = toolResult(1);

    expect(groupSecondaryTranscriptParts([callA, callB, resultA, resultB])).toEqual([
      [callA],
      [callB],
      [resultA],
      [resultB]
    ]);
  });

  it("keeps an unnamed result separate when several calls are pending", () => {
    const callA = toolCall(1);
    const callB = toolCall(2);
    const unnamedResult: TranscriptPart = {
      status: "unknown",
      text: "ambiguous",
      toolName: null,
      type: "tool_result"
    };

    expect(groupSecondaryTranscriptParts([callA, callB, unnamedResult])).toEqual([
      [callA],
      [callB],
      [unnamedResult]
    ]);
  });
});
