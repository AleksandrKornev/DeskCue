import clsx from "clsx";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";

import { TranscriptAttachmentCard } from "@modules/transcript/RichTranscriptContent/TranscriptAttachment/TranscriptAttachment";
import type { AttachmentPart } from "@modules/transcript/RichTranscriptContent/types";

import { AttachmentClusterItem } from "./AttachmentClusterItem";
import styles from "./styles.module.scss";
import type { AttachmentClusterProps } from "./types";

function getAttachmentClusterPartIdentity(part: AttachmentPart) {
  if (part.path) return `path\u001f${part.path}`;
  if (part.url) return `url\u001f${part.url}`;

  return `fallback\u001f${part.kind}\u001f${part.label ?? ""}`;
}

function getAttachmentClusterPartKeys(parts: AttachmentPart[]) {
  const occurrenceByIdentity = new Map<string, number>();

  return parts.map((part) => {
    const identity = getAttachmentClusterPartIdentity(part);
    const occurrence = occurrenceByIdentity.get(identity) ?? 0;

    occurrenceByIdentity.set(identity, occurrence + 1);

    return `${identity}\u001f${occurrence}`;
  });
}

function getAttachmentClusterPartIdentityFromKey(key: string) {
  const occurrenceSeparatorIndex = key.lastIndexOf("\u001f");

  return occurrenceSeparatorIndex >= 0 ? key.slice(0, occurrenceSeparatorIndex) : key;
}

export function AttachmentCluster(props: AttachmentClusterProps) {
  const { assetContext, dense = false, parts } = props;
  const partKeys = getAttachmentClusterPartKeys(parts);
  const focusedPartKeyRef = useRef<string | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const [hasShownSelector, setHasShownSelector] = useState(parts.length > 1);
  const [selectedPartKey, setSelectedPartKey] = useState<string | null>(partKeys[0] ?? null);
  const selectedPartIdentity = selectedPartKey
    ? getAttachmentClusterPartIdentityFromKey(selectedPartKey)
    : null;
  const equivalentPartKey = selectedPartIdentity
    ? partKeys.find(
        (partKey) => getAttachmentClusterPartIdentityFromKey(partKey) === selectedPartIdentity
      )
    : undefined;
  const resolvedSelectedPartKey = selectedPartKey && partKeys.includes(selectedPartKey)
    ? selectedPartKey
    : equivalentPartKey ?? partKeys[0] ?? null;
  const selectedIndex = resolvedSelectedPartKey
    ? partKeys.indexOf(resolvedSelectedPartKey)
    : -1;
  const selectedPart = selectedIndex >= 0 ? parts[selectedIndex] : undefined;

  useEffect(() => {
    if (selectedPartKey === resolvedSelectedPartKey) return;

    setSelectedPartKey(resolvedSelectedPartKey);
  }, [resolvedSelectedPartKey, selectedPartKey]);

  useEffect(() => {
    if (hasShownSelector || parts.length <= 1) return;

    setHasShownSelector(true);
  }, [hasShownSelector, parts.length]);

  useLayoutEffect(() => {
    const focusedPartKey = focusedPartKeyRef.current;

    if (!focusedPartKey || partKeys.includes(focusedPartKey)) return;

    const activeItem = railRef.current?.querySelector<HTMLButtonElement>(
      '[role="radio"][aria-checked="true"]'
    );

    activeItem?.focus();
    focusedPartKeyRef.current = resolvedSelectedPartKey;
  });

  if (!selectedPart || !resolvedSelectedPartKey) return null;

  if (!hasShownSelector && parts.length === 1) {
    return (
      <TranscriptAttachmentCard
        assetContext={assetContext}
        dense={dense}
        key={resolvedSelectedPartKey}
        part={selectedPart}
      />
    );
  }

  return (
    <div className={clsx(styles.attachmentGroup, dense && styles.attachmentGroupDense)}>
      <div className={styles.attachmentGroupHeader}>
        <div>
          <strong>Assets</strong>
          <span>{parts.length} {parts.length === 1 ? "file" : "files"} attached</span>
        </div>
        <span className={styles.attachmentGroupCounter}>
          {selectedIndex + 1}/{parts.length}
        </span>
      </div>

      <div
        aria-label="Message assets"
        aria-orientation="horizontal"
        className={styles.attachmentGroupRail}
        ref={railRef}
        role="radiogroup"
      >
        {parts.map((part, index) => (
          <AttachmentClusterItem
            assetContext={assetContext}
            isActive={index === selectedIndex}
            key={partKeys[index]}
            onBlur={() => {
              if (focusedPartKeyRef.current === partKeys[index]) focusedPartKeyRef.current = null;
            }}
            onFocus={() => {
              focusedPartKeyRef.current = partKeys[index] ?? null;
            }}
            onSelect={() => setSelectedPartKey(partKeys[index] ?? null)}
            part={part}
            position={index + 1}
            total={parts.length}
          />
        ))}
      </div>

      <TranscriptAttachmentCard
        assetContext={assetContext}
        compact
        dense={dense}
        key={resolvedSelectedPartKey}
        part={selectedPart}
      />
    </div>
  );
}
