import clsx from "clsx";
import { useLayoutEffect, useRef } from "react";

import styles from "@modules/agents/panel/styles.module.scss";
import type { MobileAgentSessionDetailProps } from "@modules/agents/types";
import { useDeskCueLayoutMode } from "@web/layout";

export function MobileAgentSessionDetail(props: MobileAgentSessionDetailProps) {
  const { agentSessionId, transcriptPanel, onBackToChats } = props;
  const layoutMode = useDeskCueLayoutMode();
  const detailRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scrollToDetail = () => {
      const detail = detailRef.current;
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
    };
    const frameId = window.requestAnimationFrame(scrollToDetail);
    const timeoutId = window.setTimeout(scrollToDetail, 160);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [agentSessionId, layoutMode]);

  return (
    <div className={styles.mobileDetail} ref={detailRef}>
      <div className={styles.mobileDetailToolbar}>
        <button
          className={clsx(styles.button, styles.ghostButton)}
          onClick={onBackToChats}
          type="button"
        >
          Back to chats
        </button>
      </div>
      {transcriptPanel}
    </div>
  );
}
