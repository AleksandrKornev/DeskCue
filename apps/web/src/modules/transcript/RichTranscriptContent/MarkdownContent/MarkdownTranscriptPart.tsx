import {
  createContext,
  useContext,
  useMemo
} from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  createSyntheticDiffPart,
  extractMarkdownCodeLanguage,
  flattenMarkdownCodeChildren,
  looksLikeUnifiedDiff,
  normalizeTranscriptMarkdown,
  normalizeMarkdownLocalAssetPath
} from "@modules/transcript/RichTranscriptContent/helpers";
import { TranscriptDiffList } from "@modules/transcript/RichTranscriptContent/TranscriptDiff";

import {
  isMarkdownLocalImagePath,
  transformTranscriptUrl
} from "./helpers";
import { LocalMarkdownAssetLink } from "./LocalMarkdownAssetLink";
import { LocalMarkdownImage } from "./LocalMarkdownImage";
import styles from "./styles.module.scss";
import type { MarkdownTranscriptPartProps } from "./types";

const MarkdownInteractiveParentContext = createContext(false);

function MarkdownImageRenderer({
  alt,
  assetContext,
  src
}: {
  alt: string | undefined;
  assetContext: MarkdownTranscriptPartProps["assetContext"];
  src: string | undefined;
}) {
  const hasInteractiveParent = useContext(MarkdownInteractiveParentContext);

  if (!src) return null;

  const localAssetPath = normalizeMarkdownLocalAssetPath(src);

  if (!localAssetPath) return <img alt={alt ?? ""} loading="lazy" src={src} />;

  if (!isMarkdownLocalImagePath(localAssetPath)) {
    const displayName = alt?.trim() || localAssetPath.split(/[\\/]/u).pop() || localAssetPath;

    if (hasInteractiveParent) {
      return <span className={styles.localLink} title={localAssetPath}>{displayName}</span>;
    }

    return (
      <LocalMarkdownAssetLink
        assetContext={assetContext}
        assetPath={localAssetPath}
        displayName={displayName}
      >
        {displayName}
      </LocalMarkdownAssetLink>
    );
  }

  return (
    <LocalMarkdownImage
      alt={alt ?? ""}
      assetContext={assetContext}
      assetPath={localAssetPath}
    />
  );
}

function createMarkdownAssetContext(
  agentSessionId: string | undefined,
  managedSessionId: string | undefined,
  workspaceId: string | undefined
): MarkdownTranscriptPartProps["assetContext"] {
  if (!agentSessionId && !managedSessionId && !workspaceId) return undefined;

  return { agentSessionId, managedSessionId, workspaceId };
}

function createMarkdownComponents(
  assetContext: MarkdownTranscriptPartProps["assetContext"]
): Components {
  return {
    pre: ({ children }) => <>{children}</>,
    a: ({ href, children }) => {
      if (!href) return <span>{children}</span>;

      const localAssetPath = normalizeMarkdownLocalAssetPath(href);

      if (localAssetPath) {
        const displayName = flattenMarkdownCodeChildren(children).trim() || localAssetPath;

        return (
          <LocalMarkdownAssetLink
            assetContext={assetContext}
            assetPath={localAssetPath}
            displayName={displayName}
          >
            <MarkdownInteractiveParentContext.Provider value>
              {children}
            </MarkdownInteractiveParentContext.Provider>
          </LocalMarkdownAssetLink>
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
          <MarkdownInteractiveParentContext.Provider value>
            {children}
          </MarkdownInteractiveParentContext.Provider>
        </a>
      );
    },
    img: ({ src, alt }) => (
      <MarkdownImageRenderer alt={alt} assetContext={assetContext} src={src} />
    ),
    code: ({ children, className }) => {
      const codeText = flattenMarkdownCodeChildren(children);
      const language = extractMarkdownCodeLanguage(className);
      const isBlock = Boolean(className) || codeText.includes("\n");

      if (!isBlock) return <code>{children}</code>;

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
  };
}

export function MarkdownTranscriptPart(props: MarkdownTranscriptPartProps) {
  const { assetContext, part } = props;
  const agentSessionId = assetContext?.agentSessionId;
  const managedSessionId = assetContext?.managedSessionId;
  const workspaceId = assetContext?.workspaceId;

  const markdownText = useMemo(
    () => normalizeTranscriptMarkdown(part.text),
    [part.text]
  );

  const markdownComponents = useMemo(
    () => createMarkdownComponents(createMarkdownAssetContext(
      agentSessionId,
      managedSessionId,
      workspaceId
    )),
    [agentSessionId, managedSessionId, workspaceId]
  );

  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={transformTranscriptUrl}
        components={markdownComponents}
      >
        {markdownText}
      </ReactMarkdown>
    </div>
  );
}
