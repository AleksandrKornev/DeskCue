import type { ReactNode } from "react";

import type { TranscriptPart } from "@deskcue/protocol";
import type { LocalAssetLinkContext } from "@api/endpoint/assets/types";

import { RichTranscriptPart } from "./RichTranscriptPart";
import {
  AttachmentCluster,
  TranscriptAttachmentCard
} from "./TranscriptAttachment";
import { TranscriptDiffList } from "./TranscriptDiff";
import type {
  AttachmentPart,
  DiffPart,
  RenderTranscriptPartsOptions
} from "./types";

export function renderTranscriptParts(
  parts: TranscriptPart[],
  keyPrefix: string,
  assetContext: LocalAssetLinkContext | undefined,
  options: RenderTranscriptPartsOptions = {}
) {
  const rendered: ReactNode[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];

    if (part.type === "attachment") {
      const attachmentParts: AttachmentPart[] = [part];
      let nextIndex = index + 1;

      while (nextIndex < parts.length && parts[nextIndex]?.type === "attachment") {
        attachmentParts.push(parts[nextIndex] as AttachmentPart);
        nextIndex += 1;
      }

      rendered.push(
        attachmentParts.length === 1 ? (
          <TranscriptAttachmentCard
            assetContext={assetContext}
            dense={options.compactAttachments}
            key={`${keyPrefix}-attachment-${index}`}
            part={attachmentParts[0]}
          />
        ) : (
          <AttachmentCluster
            assetContext={assetContext}
            dense={options.compactAttachments}
            key={`${keyPrefix}-attachments-${index}`}
            parts={attachmentParts}
          />
        )
      );
      index = nextIndex - 1;
      continue;
    }

    if (part.type === "diff") {
      const diffParts: DiffPart[] = [part];
      let nextIndex = index + 1;

      while (nextIndex < parts.length && parts[nextIndex]?.type === "diff") {
        diffParts.push(parts[nextIndex] as DiffPart);
        nextIndex += 1;
      }

      rendered.push(
        <TranscriptDiffList
          key={`${keyPrefix}-diffs-${index}`}
          parts={diffParts}
        />
      );
      index = nextIndex - 1;
      continue;
    }

    rendered.push(
      <RichTranscriptPart
        assetContext={assetContext}
        key={`${keyPrefix}-${part.type}-${index}`}
        part={part}
      />
    );
  }

  return rendered;
}
