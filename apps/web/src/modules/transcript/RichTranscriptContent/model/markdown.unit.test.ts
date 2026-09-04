import { describe, expect, it } from "vitest";

import { normalizeTranscriptMarkdown } from "./markdown";

describe("normalizeTranscriptMarkdown", () => {
  it("normalizes raw Windows link and image targets for the Markdown parser", () => {
    expect(normalizeTranscriptMarkdown(
      "[report](D:\\work\\DeskCue\\report.txt)\n![shot](C:\\tmp\\shot.png)"
    )).toBe(
      "[report](</D:/work/DeskCue/report.txt>)\n![shot](</C:/tmp/shot.png>)"
    );
  });

  it("preserves parentheses and multiple Windows targets on one line", () => {
    expect(normalizeTranscriptMarkdown(
      "[copy](<D:\\dir\\copy (1)\\file.txt>) [next](C:\\tmp\\next.txt)"
    )).toBe(
      "[copy](</D:/dir/copy (1)/file.txt>) [next](</C:/tmp/next.txt>)"
    );
  });

  it("preserves quoted titles outside raw and angle Windows destinations", () => {
    expect(normalizeTranscriptMarkdown(
      "[raw](D:\\foo\\bar.txt \"report\") [angle](<D:\\foo\\bar.txt> 'details') "
      + "[parenthesized](D:\\foo\\bar.txt (summary))"
    )).toBe(
      "[raw](</D:/foo/bar.txt> \"report\") [angle](</D:/foo/bar.txt> 'details') "
      + "[parenthesized](</D:/foo/bar.txt> (summary))"
    );
  });

  it("does not rewrite ordinary web and relative targets", () => {
    const markdown = "[web](https://deskcue.io) [relative](docs/report.md)";

    expect(normalizeTranscriptMarkdown(markdown)).toBe(markdown);
  });

  it("does not rewrite plain or escaped link-like prose", () => {
    const markdown = "plain](D:\\foo\\plain.txt) \\[literal](D:\\foo\\literal.txt)";

    expect(normalizeTranscriptMarkdown(markdown)).toBe(markdown);
  });

  it("does not treat escaped backticks as inline-code delimiters", () => {
    const markdown = "\\` literal [x](D:\\foo\\bar.txt) \\`";

    expect(normalizeTranscriptMarkdown(markdown)).toBe(
      "\\` literal [x](</D:/foo/bar.txt>) \\`"
    );
  });

  it("lets a backtick preceded by a slash close an existing code span", () => {
    const markdown = "`code\\` [x](D:\\foo\\bar.txt) `";

    expect(normalizeTranscriptMarkdown(markdown)).toBe(
      "`code\\` [x](</D:/foo/bar.txt>) `"
    );
  });

  it("keeps code spans inside link labels while normalizing their Windows targets", () => {
    expect(normalizeTranscriptMarkdown(
      "[see `file`](D:\\foo\\bar.txt) [`x`](<D:\\foo\\other.txt>)"
    )).toBe(
      "[see `file`](</D:/foo/bar.txt>) [`x`](</D:/foo/other.txt>)"
    );
  });

  it("does not rewrite Windows targets shown as code examples", () => {
    const markdown = [
      "`[inline](D:\\work\\DeskCue\\inline.txt)`",
      "```md",
      "[fenced](D:\\work\\DeskCue\\fenced.txt)",
      "```",
      "[actionable](D:\\work\\DeskCue\\report.txt)"
    ].join("\n");

    expect(normalizeTranscriptMarkdown(markdown)).toBe([
      "`[inline](D:\\work\\DeskCue\\inline.txt)`",
      "```md",
      "[fenced](D:\\work\\DeskCue\\fenced.txt)",
      "```",
      "[actionable](</D:/work/DeskCue/report.txt>)"
    ].join("\n"));
  });

  it("keeps code protected when a longer backtick run or fence-like line is not a closer", () => {
    const markdown = [
      "`` `[inline](D:\\work\\DeskCue\\inline.txt)` ``",
      "```md",
      "```not-a-closing-fence",
      "[still fenced](D:\\work\\DeskCue\\fenced.txt)",
      "```",
      "[actionable](D:\\work\\DeskCue\\report.txt)"
    ].join("\n");

    expect(normalizeTranscriptMarkdown(markdown)).toBe([
      "`` `[inline](D:\\work\\DeskCue\\inline.txt)` ``",
      "```md",
      "```not-a-closing-fence",
      "[still fenced](D:\\work\\DeskCue\\fenced.txt)",
      "```",
      "[actionable](</D:/work/DeskCue/report.txt>)"
    ].join("\n"));
  });

  it("does not rewrite targets inside multiline code spans", () => {
    const markdown = [
      "`first [code](D:\\work\\DeskCue\\first.txt)",
      "second [code](D:\\work\\DeskCue\\second.txt)`",
      "[actionable](D:\\work\\DeskCue\\report.txt)"
    ].join("\n");

    expect(normalizeTranscriptMarkdown(markdown)).toBe([
      "`first [code](D:\\work\\DeskCue\\first.txt)",
      "second [code](D:\\work\\DeskCue\\second.txt)`",
      "[actionable](</D:/work/DeskCue/report.txt>)"
    ].join("\n"));
  });

  it("does not treat four-space pseudo fences as CommonMark fences", () => {
    const markdown = [
      "    ```md",
      "[actionable](D:\\work\\DeskCue\\report.txt)",
      "```md",
      "[still fenced](D:\\work\\DeskCue\\inside.txt)",
      "    ```",
      "[also fenced](D:\\work\\DeskCue\\inside-too.txt)",
      "```",
      "[after](D:\\work\\DeskCue\\after.txt)"
    ].join("\n");

    expect(normalizeTranscriptMarkdown(markdown)).toBe([
      "    ```md",
      "[actionable](</D:/work/DeskCue/report.txt>)",
      "```md",
      "[still fenced](D:\\work\\DeskCue\\inside.txt)",
      "    ```",
      "[also fenced](D:\\work\\DeskCue\\inside-too.txt)",
      "```",
      "[after](</D:/work/DeskCue/after.txt>)"
    ].join("\n"));
  });

  it("does not rewrite Windows targets inside indented code blocks", () => {
    const markdown = [
      "    [sample](D:\\work\\DeskCue\\sample.txt)",
      "\t[tabbed](D:\\work\\DeskCue\\tabbed.txt)",
      " \t[mixed](D:\\work\\DeskCue\\mixed.txt)",
      "",
      "[actionable](D:\\work\\DeskCue\\report.txt)"
    ].join("\n");

    expect(normalizeTranscriptMarkdown(markdown)).toBe([
      "    [sample](D:\\work\\DeskCue\\sample.txt)",
      "\t[tabbed](D:\\work\\DeskCue\\tabbed.txt)",
      " \t[mixed](D:\\work\\DeskCue\\mixed.txt)",
      "",
      "[actionable](</D:/work/DeskCue/report.txt>)"
    ].join("\n"));
  });

  it("normalizes an indented Windows target that continues a paragraph", () => {
    const markdown = [
      "Paragraph",
      "    [actionable](D:\\work\\DeskCue\\report.txt)"
    ].join("\n");

    expect(normalizeTranscriptMarkdown(markdown)).toBe([
      "Paragraph",
      "    [actionable](</D:/work/DeskCue/report.txt>)"
    ].join("\n"));
  });

  it("normalizes an indented Windows target that continues a list item", () => {
    const markdown = [
      "- Item",
      "    [actionable](D:\\work\\DeskCue\\report.txt)"
    ].join("\n");

    expect(normalizeTranscriptMarkdown(markdown)).toBe([
      "- Item",
      "    [actionable](</D:/work/DeskCue/report.txt>)"
    ].join("\n"));
  });

  it.each([
    { lines: [
      "- outer",
      "  - nested",
      "",
      "      [actionable](D:\\work\\DeskCue\\report.txt)"
    ] },
    { lines: [
      "- outer",
      "  - nested",
      "",
      "",
      "      [actionable](D:\\work\\DeskCue\\report.txt)"
    ] },
    { lines: [
      "- outer",
      "    paragraph",
      "      [actionable](D:\\work\\DeskCue\\report.txt)"
    ] }
  ])("normalizes a Windows target inside an implicit nested-list continuation", ({ lines }) => {
    expect(normalizeTranscriptMarkdown(lines.join("\n"))).toBe([
      ...lines.slice(0, -1),
      "      [actionable](</D:/work/DeskCue/report.txt>)"
    ].join("\n"));
  });

  it("does not rewrite Windows targets inside blockquoted indented code", () => {
    const markdown = ">     [sample](D:\\work\\DeskCue\\sample.txt)";

    expect(normalizeTranscriptMarkdown(markdown)).toBe(markdown);
  });

  it.each([
    "-     [sample](D:\\work\\DeskCue\\sample.txt)",
    "1.      [sample](D:\\work\\DeskCue\\sample.txt)",
    "> -     [sample](D:\\work\\DeskCue\\sample.txt)",
    "- >     [sample](D:\\work\\DeskCue\\sample.txt)",
    [
      "- > Item",
      "- >     [sample](D:\\work\\DeskCue\\sample.txt)"
    ].join("\n")
  ])("does not rewrite Windows targets inside marker-line list code: %s", (markdown) => {
    expect(normalizeTranscriptMarkdown(markdown)).toBe(markdown);
  });

  it("bounds CommonMark context parsing when a large transcript contains a code candidate", () => {
    const nestedTarget = "[x](C:\\foo ";
    const markdown = `${nestedTarget.repeat(14_000)}${")".repeat(14_000)}\n` +
      "    [sample](D:\\work\\DeskCue\\sample.txt)";
    const startedAt = performance.now();

    normalizeTranscriptMarkdown(markdown);

    expect(markdown.length).toBeGreaterThan(150_000);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("bounds CommonMark context parsing for a candidate-heavy transcript", () => {
    const pair = "Paragraph\n    [sample](D:\\work\\DeskCue\\sample.txt)\n";
    const markdown = pair.repeat(20_000);
    const startedAt = performance.now();
    const normalized = normalizeTranscriptMarkdown(markdown);

    expect(normalized.startsWith(
      "Paragraph\n    [sample](</D:/work/DeskCue/sample.txt>)\n"
    )).toBe(true);
    expect(normalized.endsWith(pair)).toBe(true);
    expect(markdown.length).toBeGreaterThan(1_000_000);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("applies one uniform CommonMark context decision to every represented line", () => {
    const markdown = [
      "Paragraph",
      "    [first](D:\\work\\DeskCue\\first.txt)",
      "    [second](D:\\work\\DeskCue\\second.txt)"
    ].join("\n");

    expect(normalizeTranscriptMarkdown(markdown)).toBe([
      "Paragraph",
      "    [first](</D:/work/DeskCue/first.txt>)",
      "    [second](</D:/work/DeskCue/second.txt>)"
    ].join("\n"));
  });

  it("preserves candidates after a previous line exceeds the bounded syntax context", () => {
    const markdown = [
      `<script>${"x".repeat(5_000)}</script>`,
      "    [sample](D:\\work\\DeskCue\\sample.txt)"
    ].join("\n");

    expect(normalizeTranscriptMarkdown(markdown)).toBe(markdown);
  });

  it("keeps top-level Windows links actionable across repeated single-blank groups", () => {
    const group = "Paragraph\n    [asset](D:\\work\\Desk Cue\\report 2026.txt)\n\n";
    const markdown = group.repeat(30);
    const normalizedTarget = "    [asset](</D:/work/Desk Cue/report 2026.txt>)";

    expect(normalizeTranscriptMarkdown(markdown).split(normalizedTarget)).toHaveLength(31);
  });

  it("does not treat a backtick-containing info string as a fence opener", () => {
    const markdown = [
      "```lang`invalid",
      "[actionable](D:\\work\\DeskCue\\report.txt)"
    ].join("\n");

    expect(normalizeTranscriptMarkdown(markdown)).toBe([
      "```lang`invalid",
      "[actionable](</D:/work/DeskCue/report.txt>)"
    ].join("\n"));
  });

  it("normalizes a near-limit transcript with many protected spans in bounded time", () => {
    const markdown = Array.from({ length: 10_000 }, (_, index) =>
      `\`[code-${index}](D:\\private\\code-${index}.txt)\` [file](D:\\work\\file-${index}.txt)`
    ).join("\n");
    const startedAt = performance.now();
    const normalized = normalizeTranscriptMarkdown(markdown);

    expect(normalized).toContain("`[code-9999](D:\\private\\code-9999.txt)`");
    expect(normalized).toContain("[file](</D:/work/file-9999.txt>)");
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("normalizes a two-megabyte transcript without overflowing function arguments", () => {
    const line = "[x](C:\\a.txt)";
    const markdown = Array.from({ length: 150_000 }, () => line).join("\n");
    const normalized = normalizeTranscriptMarkdown(markdown);

    expect(markdown.length).toBeGreaterThan(2_000_000);
    expect(normalized.startsWith("[x](</C:/a.txt>)\n")).toBe(true);
    expect(normalized.endsWith("\n[x](</C:/a.txt>)")).toBe(true);
  });

  it("keeps repeated malformed Windows targets within a linear-time pass", () => {
    const malformedTarget = "[x](C:\\unterminated ";
    const markdown = malformedTarget.repeat(8_000);
    const startedAt = performance.now();
    const normalized = normalizeTranscriptMarkdown(markdown);

    expect(markdown.length).toBeGreaterThan(150_000);
    expect(normalized).toBe(markdown);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("normalizes a valid same-line target after an unterminated target", () => {
    const markdown = "[bad](C:\\unterminated [good](D:\\ok.txt)";

    expect(normalizeTranscriptMarkdown(markdown)).toBe(
      "[bad](C:\\unterminated [good](</D:/ok.txt>)"
    );
  });

  it("normalizes a valid same-line target inside an unterminated angle target", () => {
    const markdown = "[bad](<C:\\unterminated [good](D:\\ok.txt)";

    expect(normalizeTranscriptMarkdown(markdown)).toBe(
      "[bad](<C:\\unterminated [good](</D:/ok.txt>)"
    );
  });

  it("normalizes a valid same-line target inside an unterminated quoted title", () => {
    const markdown = "[bad](C:\\target \"unterminated) [good](D:\\ok.txt)";

    expect(normalizeTranscriptMarkdown(markdown)).toBe(
      "[bad](C:\\target \"unterminated) [good](</D:/ok.txt>)"
    );
  });

  it.each([
    [
      "[x](<D:\\foo[bar](baz.txt>)",
      "[x](</D:/foo[bar](baz.txt>)"
    ],
    [
      "[x](D:\\target \"title [foo](bar\")",
      "[x](</D:/target> \"title [foo](bar\")"
    ]
  ])("keeps literal ]( text inside a valid target context: %s", (markdown, expected) => {
    expect(normalizeTranscriptMarkdown(markdown)).toBe(expected);
  });

  it.each([
    "[bad](<C:\\unterminated [good](D:\\ok.txt)>",
    "[bad](C:\\target \"unterminated [good](D:\\ok.txt)\" tail"
  ])("recovers a nested link when the outer context has no closing parenthesis: %s", (markdown) => {
    expect(normalizeTranscriptMarkdown(markdown)).toContain("[good](</D:/ok.txt>)");
  });

  it.each([
    "[bad](<C:\\outer [good](D:\\ok.txt)> invalid)",
    "[bad](C:\\outer \"title [good](D:\\ok.txt)\" invalid)"
  ])("recovers a nested link from a structurally closed invalid context: %s", (markdown) => {
    expect(normalizeTranscriptMarkdown(markdown)).toContain("[good](</D:/ok.txt>)");
  });

  it("recovers a nested link from an angle target containing another unescaped opener", () => {
    const markdown = "[bad](<C:\\foo< [good](D:\\ok.txt)>)";

    expect(normalizeTranscriptMarkdown(markdown)).toContain("[good](</D:/ok.txt>)");
  });

  it.each([
    "[bad](<C:\\outer [good](D:\\ok.txt)> \\x)",
    "[bad](C:\\outer \"title [good](D:\\ok.txt)\" \\x)"
  ])("recovers a nested link from a context with an escaped invalid suffix: %s", (markdown) => {
    expect(normalizeTranscriptMarkdown(markdown)).toContain("[good](</D:/ok.txt>)");
  });

  it.each([
    "[bad](<C:\\outer [good](D:\\ok.txt)> invalid \"title\")",
    "[bad](C:\\outer \"first [good](D:\\ok.txt)\" \"second\")"
  ])("does not let a later title reset an invalid target context: %s", (markdown) => {
    expect(normalizeTranscriptMarkdown(markdown)).toContain("[good](</D:/ok.txt>)");
  });

  it.each([
    ["[x](<D:\\foo> (literal ]( text))", "[x](</D:/foo> (literal ]( text))"],
    ["[x](D:\\foo (literal ]( text))", "[x](</D:/foo> (literal ]( text))"]
  ])("preserves a parenthesized Markdown title while normalizing %s", (markdown, expected) => {
    expect(normalizeTranscriptMarkdown(markdown)).toBe(expected);
  });

  it("does not re-scan every nested raw target during context validation", () => {
    const nestedTarget = "[x](C:\\foo ";
    const markdown = `${nestedTarget.repeat(14_000)}${")".repeat(14_000)}`;
    const startedAt = performance.now();

    normalizeTranscriptMarkdown(markdown);

    expect(markdown.length).toBeGreaterThan(150_000);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("records nested quoted-title validity without scanning ancestor ranges", () => {
    const nesting = 14_000;
    const markdown = `${"[x](".repeat(nesting)}[leaf](D:\\a.txt)${" \"t\")".repeat(nesting)}`;
    const startedAt = performance.now();

    normalizeTranscriptMarkdown(markdown);

    expect(markdown.length).toBeGreaterThan(120_000);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("keeps a malformed angle target with many closers within a linear-time pass", () => {
    const markdown = `[x](<C:\\target> "${"a)".repeat(80_000)}`;
    const startedAt = performance.now();
    const normalized = normalizeTranscriptMarkdown(markdown);

    expect(markdown.length).toBeGreaterThan(150_000);
    expect(normalized).toBe(markdown);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it.each([
    ["[x](<D:\\foo)bar.txt>)", "[x](</D:/foo)bar.txt>)"],
    ["[x](<D:\\foo.txt> \"a)\")", "[x](</D:/foo.txt> \"a)\")"],
    ["[x](D:\\foo\\)bar.txt)", "[x](</D:/foo/)bar.txt>)"],
    ["[x](D:\\target \"a)b\")", "[x](</D:/target> \"a)b\")"]
  ])("preserves Markdown delimiters while normalizing %s", (markdown, expected) => {
    expect(normalizeTranscriptMarkdown(markdown)).toBe(expected);
  });

  it("bounds missing angle-target terminator scans", () => {
    const malformedTarget = "[x](<C:\\missing)";
    const markdown = `${malformedTarget.repeat(13_000)}>`;
    const startedAt = performance.now();
    const normalized = normalizeTranscriptMarkdown(markdown);

    expect(markdown.length).toBeGreaterThan(200_000);
    expect(normalized).toBe(markdown);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});
