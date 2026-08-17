import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { formatDate } from "@lib/format";
import { labelForTranscriptRole } from "@models/transcriptEntries";
import type { TextOnlyTranscriptEntry } from "@modules/transcript/AgentTranscriptPanel/types";
import { normalizeTranscriptMarkdown } from "@modules/transcript/RichTranscriptContent/helpers";

import { transcriptEntryClassByRole } from "./constants";
import { flattenPreviewMarkdownCodeChildren } from "./helpers";
import styles from "./styles.module.scss";

export function TranscriptPreviewEntry(props: { entry: TextOnlyTranscriptEntry }) {
  const { entry } = props;
  const markdownText = normalizeTranscriptMarkdown(entry.text);

  return (
    <article
      className={clsx(styles.entry, transcriptEntryClassByRole[entry.role])}
    >
      <header>
        <span className={styles.entryMeta}>
          <strong>{labelForTranscriptRole(entry.role)}</strong>
          <span>{formatDate(entry.timestamp)}</span>
        </span>
      </header>
      <div className={styles.richTranscript}>
        <div className={styles.richTranscriptMarkdown}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              img: () => null,
              a: ({ children }) => <span>{children}</span>,
              pre: ({ children }) => <pre>{children}</pre>,
              code: ({ children, className }) => {
                const codeText = flattenPreviewMarkdownCodeChildren(children);
                const isBlock = Boolean(className) || codeText.includes("\n");

                return isBlock ? (
                  <code className={className}>{codeText}</code>
                ) : (
                  <code>{codeText.trim() || "``"}</code>
                );
              }
            }}
          >
            {markdownText}
          </ReactMarkdown>
        </div>
      </div>
    </article>
  );
}
