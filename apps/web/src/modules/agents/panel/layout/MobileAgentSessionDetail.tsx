import clsx from "clsx";
import { useId, useLayoutEffect, useRef } from "react";

import styles from "@modules/agents/panel/styles.module.scss";
import type { MobileAgentSessionDetailProps } from "@modules/agents/types";
import { useDeskCueLayoutMode } from "@web/layout";
import type { DeskCueLayoutMode } from "@web/layout";

function scrollMobileDetailIntoView(detail: HTMLElement | null, layoutMode: DeskCueLayoutMode) {
  if (!detail) return;

  if (layoutMode === "embedded") {
    const remoteRoot = detail.closest<HTMLElement>("[data-deskcue-remote-root]");

    if (!remoteRoot) return;

    const top = detail.getBoundingClientRect().top -
      remoteRoot.getBoundingClientRect().top + remoteRoot.scrollTop - 12;
    const maxTop = Math.max(remoteRoot.scrollHeight - remoteRoot.clientHeight, 0);

    remoteRoot.scrollTo({ top: Math.min(Math.max(top, 0), maxTop), behavior: "auto" });

    return;
  }

  const top = detail.getBoundingClientRect().top + window.scrollY - 12;
  const maxTop = Math.max(document.documentElement.scrollHeight - window.innerHeight, 0);

  window.scrollTo({ top: Math.min(Math.max(top, 0), maxTop), behavior: "auto" });
}

function focusBackButtonIfUnowned(button: HTMLButtonElement | null) {
  if (document.activeElement === document.body) button?.focus({ preventScroll: true });
}

export function MobileAgentSessionDetail(props: MobileAgentSessionDetailProps) {
  const { agentSessionId, agentSessionLabel, transcriptPanel, onBackToChats } = props;
  const layoutMode = useDeskCueLayoutMode();
  const displayLabel = agentSessionLabel.trim() || "Selected chat";
  const headingId = useId();
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const detailRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      scrollMobileDetailIntoView(detailRef.current, layoutMode);
      focusBackButtonIfUnowned(backButtonRef.current);
    });
    const timeoutId = window.setTimeout(() => {
      scrollMobileDetailIntoView(detailRef.current, layoutMode);
    }, 160);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [agentSessionId, layoutMode]);

  return (
    <section aria-labelledby={headingId} className={styles.mobileDetail} ref={detailRef}>
      <h2 className={styles.srOnly} id={headingId}>
        {displayLabel}
      </h2>
      <div className={styles.mobileDetailToolbar}>
        <button
          className={clsx(styles.button, styles.ghostButton)}
          data-chat-list-focus-fallback=""
          data-chat-list-focus-priority=""
          ref={backButtonRef}
          onClick={(event) => onBackToChats(event.currentTarget)}
          type="button"
        >
          Back to chats
        </button>
      </div>
      {transcriptPanel}
    </section>
  );
}
