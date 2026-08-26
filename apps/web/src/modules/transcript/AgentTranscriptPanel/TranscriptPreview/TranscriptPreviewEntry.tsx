import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { LocalAssetLinkContext } from "@api/endpoint/assets/types";
import { formatDate } from "@lib/format";
import { labelForTranscriptRole } from "@models/transcriptEntries";
import type { TextOnlyTranscriptEntry } from "@modules/transcript/AgentTranscriptPanel/types";
import {
  flattenMarkdownCodeChildren,
  normalizeMarkdownLocalAssetPath,
  normalizeTranscriptMarkdown
} from "@modules/transcript/RichTranscriptContent/helpers";
import { transformTranscriptUrl } from "@modules/transcript/RichTranscriptContent/MarkdownContent/helpers";
import { LocalMarkdownAssetLink } from "@modules/transcript/RichTranscriptContent/MarkdownContent/LocalMarkdownAssetLink";

import { transcriptEntryClassByRole } from "./constants";
import { flattenPreviewMarkdownCodeChildren } from "./helpers";
import styles from "./styles.module.scss";

export function TranscriptPreviewEntry(props: {
  assetContext?: LocalAssetLinkContext;
  entry: TextOnlyTranscriptEntry;
}) {
  const { assetContext, entry } = props;
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
            urlTransform={transformTranscriptUrl}
            components={{
              img: () => null,
              a: ({ children, href }) => {
                if (!href) return <span>{children}</span>;

                const localAssetPath = normalizeMarkdownLocalAssetPath(href);

                if (!localAssetPath) return <span>{children}</span>;

                const displayName = flattenMarkdownCodeChildren(children).trim() || localAssetPath;

                return (
                  <LocalMarkdownAssetLink
                    assetContext={assetContext}
                    assetPath={localAssetPath}
                    displayName={displayName}
                  >
                    {children}
                  </LocalMarkdownAssetLink>
                );
              },
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
