import styles from "./styles.module.scss";
import type { ManagedSessionSurfaceProps } from "./types";

export function ManagedSessionSurface({
  children,
  sessionShell
}: ManagedSessionSurfaceProps) {
  const isLiveChat = Boolean(sessionShell.sourceSessionId);
  const title = isLiveChat ? "Live chat" : "Active DeskCue session";
  const subtitle = isLiveChat
    ? "DeskCue already controls this thread. Continue the conversation here"
    : "This is a manual command fallback. Keep it secondary unless no adapter exists yet";

  return (
    <section className={isLiveChat ? styles.liveChatPanel : styles.panel}>
      {!isLiveChat ? (
        <header className={styles.panelHeader}>
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
        </header>
      ) : null}
      <div className={isLiveChat ? styles.liveChatPanelBody : styles.panelBody}>{children}</div>
    </section>
  );
}
