import clsx from "clsx";

import { SessionMessageComposer } from "@modules/session/composer";

import { DebugEventList } from "./DebugEventList";
import styles from "./styles.module.scss";
import { TabPanelSurface } from "./TabPanelSurface";
import type { LogsTabPanelProps } from "./types";

export function LogsTabPanel({
  actionRequest,
  activePromptText,
  canSendInput,
  debugEntries,
  draftScopeKey,
  hasSelectedSession,
  hasSourceSession,
  inputUnavailableLabel,
  isInterruptingPrompt,
  isPromptInFlight,
  isPromptQueued,
  liveUpdatesConnection,
  sharedSessionHint,
  viewerCount,
  onInterruptPrompt,
  onSendInput,
}: LogsTabPanelProps) {
  return (
    <div className={clsx(styles.tabPanel, styles.stackLarge)}>
      <TabPanelSurface
        title={hasSourceSession ? "Transport events" : "Command output"}
        subtitle={
          hasSourceSession
            ? "Transport-level events for the taken-over chat. Readable conversation turns stay in the transcript"
            : "Filtered stdout, stderr, and PTY events. ANSI/control noise is hidden so the transport stays readable"
        }
      >
        <DebugEventList
          debugEntries={debugEntries}
          hasSelectedSession={hasSelectedSession}
          hasSourceSession={hasSourceSession}
        />
      </TabPanelSurface>

      {!hasSourceSession ? (
        <TabPanelSurface
          title="Send message"
          subtitle="Use this to reply to a manual command"
        >
          <SessionMessageComposer
            activePromptText={activePromptText}
            actionRequest={actionRequest}
            canSendInput={canSendInput}
            draftScopeKey={draftScopeKey}
            inputUnavailableLabel={inputUnavailableLabel}
            isInterruptingPrompt={isInterruptingPrompt}
            isPromptInFlight={isPromptInFlight}
            isPromptQueued={isPromptQueued}
            liveUpdatesConnection={liveUpdatesConnection}
            mode="inline"
            onInterruptPrompt={onInterruptPrompt}
            onSendInput={onSendInput}
            sharedSessionHint={sharedSessionHint}
            viewerCount={viewerCount}
          />
        </TabPanelSurface>
      ) : null}
    </div>
  );
}
