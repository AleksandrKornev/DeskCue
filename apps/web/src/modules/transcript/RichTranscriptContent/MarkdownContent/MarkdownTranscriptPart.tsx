import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  createSyntheticDiffPart,
  extractMarkdownCodeLanguage,
  flattenMarkdownCodeChildren,
  looksLikeUnifiedDiff,
  normalizeTranscriptMarkdown,
  normalizeMarkdownLocalAssetPath
} from "@modules/transcript/RichTranscriptContent/helpers";
import { openLocalAssetInNewTab } from "@modules/transcript/RichTranscriptContent/localAssetActions";
import { TranscriptDiffList } from "@modules/transcript/RichTranscriptContent/TranscriptDiff";

import { LocalMarkdownImage } from "./LocalMarkdownImage";
import styles from "./styles.module.scss";
import type { MarkdownTranscriptPartProps } from "./types";

export function MarkdownTranscriptPart(props: MarkdownTranscriptPartProps) {
  const { assetContext, part } = props;
  const markdownText = normalizeTranscriptMarkdown(part.text);

  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          a: ({ href, children }) => {
            if (!href) {
              return <span>{children}</span>;
            }

            const localAssetPath = normalizeMarkdownLocalAssetPath(href);

            if (localAssetPath) {
              const displayName = flattenMarkdownCodeChildren(children).trim() || localAssetPath;

              return (
                <button
                  className={styles.localAssetButton}
                  onClick={() => {
                    void openLocalAssetInNewTab(localAssetPath, displayName, assetContext);
                  }}
                  title={localAssetPath}
                  type="button"
                >
                  {children}
                </button>
              );
            }

            const isExternal = /^https?:\/\//i.test(href);

            if (!isExternal) {
              return (
                <span className={styles.localLink} title={href}>
                  {children}
                </span>
              );
            }

            return (
              <a href={href} rel="noreferrer" target="_blank">
                {children}
              </a>
            );
          },
          img: ({ src, alt }) => {
            if (!src) {
              return null;
            }

            const localAssetPath = normalizeMarkdownLocalAssetPath(src);
            if (localAssetPath) {
              return (
                <LocalMarkdownImage
                  alt={alt ?? ""}
                  assetContext={assetContext}
                  assetPath={localAssetPath}
                />
              );
            }

            return <img alt={alt ?? ""} loading="lazy" src={src} />;
          },
          code: ({ children, className }) => {
            const codeText = flattenMarkdownCodeChildren(children);
            const language = extractMarkdownCodeLanguage(className);
            const isBlock = Boolean(className) || codeText.includes("\n");

            if (!isBlock) {
              return <code>{children}</code>;
            }

            if (language === "diff" || language === "patch" || looksLikeUnifiedDiff(codeText)) {
              return (
                <TranscriptDiffList
                  parts={[
                    createSyntheticDiffPart(
                      codeText,
                      language === "patch" ? "Patch" : "Unified diff"
                    )
                  ]}
                />
              );
            }

            return (
              <pre>
                <code className={className}>{codeText}</code>
              </pre>
            );
          }
        }}
      >
        {markdownText}
      </ReactMarkdown>
    </div>
  );
}
