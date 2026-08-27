import clsx from "clsx";
import { useLayoutEffect, useRef, useState } from "react";

import { KeyValue, StatusBadge } from "@components/Panel";
import { SegmentedTabs } from "@components/SegmentedTabs";
import { formatDate } from "@lib/format";
import {
  formatManagedSessionSubtitle,
  formatManagedSessionTitle
} from "@models/sessionDisplay";
import {
  getSessionTabLabel,
  getSessionTabsForCapabilities
} from "@models/sessionTabs";
import {
  getDeskCueRuntime,
  resolveSessionCommandsUnavailableReason
} from "@runtime";

import styles from "./styles.module.scss";
import type { ManualSessionChromeProps } from "./types";

const MANUAL_COMMAND_ACCESSIBLE_PREVIEW_LENGTH = 160;

type ManualCommandOverflow = {
  command: string;
  sessionId: string;
  value: boolean;
};

type ManualCommandDisclosureState = {
  command: string;
  isExpanded: boolean;
  sessionId: string;
};

function isManualCommandOverflowing(element: HTMLElement) {
  return element.scrollHeight > element.clientHeight;
}

export function ManualSessionChrome({
  activeSelectedSession,
  activeTab,
  navigationCapabilities,
  navigationIdPrefix,
  sessionShell,
  takenOverAgentSession,
  onExitSession,
  onRefreshGit,
  onSelectTab,
  onStopSession,
}: ManualSessionChromeProps) {
  const runtime = getDeskCueRuntime();
  const sessionCommandsEnabled = runtime.features.sessionCommands;
  const sessionCommandsUnavailableReason = resolveSessionCommandsUnavailableReason(runtime);
  const command = formatManagedSessionTitle(sessionShell, takenOverAgentSession);
  const commandContentId = `${navigationIdPrefix}-command`;
  const commandRef = useRef<HTMLParagraphElement>(null);
  const [commandDisclosure, setCommandDisclosure] = useState<ManualCommandDisclosureState>(() => ({
    command,
    isExpanded: false,
    sessionId: sessionShell.id
  }));
  const [commandOverflow, setCommandOverflow] = useState<ManualCommandOverflow | null>(null);
  const ownsCommandDisclosure = commandDisclosure.command === command &&
    commandDisclosure.sessionId === sessionShell.id;
  const isCommandExpanded = ownsCommandDisclosure && commandDisclosure.isExpanded;
  const hasCommandDisclosure = commandOverflow?.command === command &&
    commandOverflow.sessionId === sessionShell.id &&
    commandOverflow.value;
  const accessibleCommandPreview = command.length > MANUAL_COMMAND_ACCESSIBLE_PREVIEW_LENGTH
    ? `${command.slice(0, MANUAL_COMMAND_ACCESSIBLE_PREVIEW_LENGTH).trimEnd()}…`
    : command;

  // React retries this render before commit, so another command cannot inherit expanded state.
  if (!ownsCommandDisclosure) setCommandDisclosure({ command, isExpanded: false, sessionId: sessionShell.id });

  useLayoutEffect(() => {
    const commandElement = commandRef.current;

    if (!commandElement || isCommandExpanded) return;

    /* runtime-helper-placement: allow -- captures the current element and session. */ const measureCommandOverflow = () => {
      const value = isManualCommandOverflowing(commandElement);

      setCommandOverflow((current) => {
        if (
          current?.command === command &&
          current.sessionId === sessionShell.id &&
          current.value === value
        ) {
          return current;
        }

        return { command, sessionId: sessionShell.id, value };
      });
    };

    measureCommandOverflow();
    if (typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(measureCommandOverflow);

    resizeObserver.observe(commandElement);

    return () => resizeObserver.disconnect();
  }, [command, isCommandExpanded, sessionShell.id]);

  return (
    <>
      <div className={styles.sessionHeader}>
        <div>
          <div className={styles.sessionHeaderTitle}>
            <h2>Manual command</h2>
            <StatusBadge status={sessionShell.status} />
          </div>
          <p
            className={clsx(
              styles.sessionHeaderCommand,
              hasCommandDisclosure && styles.sessionHeaderCommandCollapsible,
              isCommandExpanded && styles.sessionHeaderCommandExpanded
            )}
            id={commandContentId}
            ref={commandRef}
            aria-hidden={hasCommandDisclosure && !isCommandExpanded ? true : undefined}
          >
            {command}
          </p>
          {hasCommandDisclosure && !isCommandExpanded ? (
            <span className={styles.srOnly}>Command preview: {accessibleCommandPreview}</span>
          ) : null}
          {hasCommandDisclosure ? (
            <button
              aria-controls={commandContentId}
              aria-expanded={isCommandExpanded}
              className={styles.commandDisclosure}
              onClick={() => setCommandDisclosure((current) => ({
                command,
                isExpanded: current.command === command && current.sessionId === sessionShell.id
                  ? !current.isExpanded
                  : true,
                sessionId: sessionShell.id
              }))}
              type="button"
            >
              {isCommandExpanded ? "Collapse command" : "Show full command"}
            </button>
          ) : null}
          <p className={styles.muted}>
            {formatManagedSessionSubtitle(sessionShell, takenOverAgentSession)}
          </p>
          {!sessionCommandsEnabled && sessionShell.status === "running" ? (
            <p className={styles.muted}>
              {sessionCommandsUnavailableReason}
            </p>
          ) : null}
        </div>
        <div className={styles.actions}>
          {onRefreshGit ? (
            <button className={styles.ghostButton} onClick={onRefreshGit} type="button">
              Refresh changes
            </button>
          ) : null}
          <button className={styles.ghostButton} onClick={onExitSession} type="button">
            Back
          </button>
          {sessionCommandsEnabled && sessionShell.status === "running" ? (
            <button className={styles.dangerButton} onClick={onStopSession} type="button">
              Stop
            </button>
          ) : null}
        </div>
      </div>

      {activeSelectedSession ? (
        <div className={clsx(styles.summaryGrid, styles.summaryGridFour)}>
          <KeyValue
            className={styles.summaryKeyValue}
            label="Mode"
            value={activeSelectedSession.sourceSessionId ? "taken over chat" : "manual command"}
            valueClassName={styles.summaryKeyValueValue}
          />
          <KeyValue
            className={styles.summaryKeyValue}
            label="Started"
            value={formatDate(activeSelectedSession.startedAt)}
            valueClassName={styles.summaryKeyValueValue}
          />
          <KeyValue
            className={styles.summaryKeyValue}
            label="Branch"
            value={activeSelectedSession.git.branch ?? "n/a"}
            valueClassName={styles.summaryKeyValueValue}
          />
          <KeyValue
            className={styles.summaryKeyValue}
            label="Preview port"
            value={activeSelectedSession.preview.port ?? "off"}
            valueClassName={styles.summaryKeyValueValue}
          />
        </div>
      ) : null}

      <SegmentedTabs
        activeTab={activeTab}
        ariaLabel="Session sections"
        idPrefix={navigationIdPrefix}
        mobileLayout="fill"
        options={getSessionTabsForCapabilities(navigationCapabilities).map((tab) => ({
          key: tab.key,
          label: getSessionTabLabel(tab, navigationCapabilities)
        }))}
        onSelectTab={onSelectTab}
      />
    </>
  );
}
