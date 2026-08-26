import clsx from "clsx";
import type { CSSProperties, ReactNode, RefObject } from "react";

import type { SessionDetail, SessionSummary } from "@deskcue/protocol";
import type { LiveUpdatesConnectionState } from "@models/liveUpdatesConnection";
import { ManagedSessionChatThread } from "@modules/session/chat";
import type { ManagedSessionChatThreadProps } from "@modules/session/chat";
import { SessionMessageComposer } from "@modules/session/composer";
import type { SessionMessageComposerProps } from "@modules/session/composer";

import styles from "./styles.module.scss";

export type LiveChatOverviewProps = {
  activeSelectedSession: SessionDetail | null;
  activeTab: string;
  chatComposerShellRef: RefObject<HTMLDivElement | null>;
  chatSurfaceRef: RefObject<HTMLDivElement | null>;
  chatWorkspaceStyle: CSSProperties | undefined;
  composerSupplement?: ReactNode;
  hideComposer?: boolean;
  isCompactViewport: boolean;
  isInterruptingPrompt: boolean;
  liveUpdatesConnection: LiveUpdatesConnectionState;
  layoutMode?: "embedded" | "viewport";
  sessionShell: SessionDetail | SessionSummary;
  sharedViewerCount: number;
  threadProps: ManagedSessionChatThreadProps;
  composerProps: Pick<
    SessionMessageComposerProps,
    | "activePromptText"
    | "actionRequest"
    | "canSendInput"
    | "inputUnavailableLabel"
    | "isPromptInFlight"
    | "isPromptQueued"
    | "onInterruptPrompt"
    | "onSendInput"
    | "sharedSessionHint"
  >;
};

export function LiveChatOverview({
  activeSelectedSession,
  activeTab,
  chatComposerShellRef,
  chatSurfaceRef,
  chatWorkspaceStyle,
  composerSupplement,
  hideComposer = false,
  composerProps,
  isCompactViewport,
  isInterruptingPrompt,
  liveUpdatesConnection,
  layoutMode = "viewport",
  sessionShell,
  sharedViewerCount,
  threadProps
}: LiveChatOverviewProps) {
  return (
    <div
      className={clsx(
        styles.chatWorkspace,
        styles.chatWorkspaceStickyComposer,
        layoutMode === "embedded" ? styles.chatWorkspaceEmbedded : null
      )}
      style={chatWorkspaceStyle}
    >
      <div className={styles.chatSurface} data-chat-surface ref={chatSurfaceRef}>
        <ManagedSessionChatThread {...threadProps} />
      </div>

      <div className={styles.chatComposerShell} ref={chatComposerShellRef}>
        <div className={styles.chatComposerContent}>
          {composerSupplement ? <div className={styles.chatComposerSupplement}>{composerSupplement}</div> : null}
          {!hideComposer ? (
            <SessionMessageComposer
              {...composerProps}
              compactViewport={isCompactViewport}
              draftScopeKey={`chat:${activeSelectedSession?.id ?? sessionShell.id}:${activeTab}`}
              isInterruptingPrompt={isInterruptingPrompt}
              liveUpdatesConnection={liveUpdatesConnection}
              mode="chat"
              viewerCount={sharedViewerCount}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
