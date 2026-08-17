import { Modal } from "@components/Modal";
import { DebugEventList } from "@modules/session/tabs";
import type { DebugEntry } from "@modules/session/tabs/types";

import { useSessionDiagnostics } from "./useSessionDiagnostics";

type SessionDiagnosticsDialogProps = {
  debugEntries: DebugEntry[];
  hasSelectedSession: boolean;
  isOpen: boolean;
  sessionId: string | null;
  onClose: () => void;
};

export function SessionDiagnosticsDialog({
  debugEntries,
  hasSelectedSession,
  isOpen,
  sessionId,
  onClose
}: SessionDiagnosticsDialogProps) {
  const diagnostics = useSessionDiagnostics({
    fallbackEntries: debugEntries,
    isOpen,
    sessionId
  });

  return (
    <Modal
      description="Transport and process events for troubleshooting this session"
      isOpen={isOpen}
      size="default"
      title="Session diagnostics"
      onClose={onClose}
    >
      {diagnostics.loading ? <p role="status">Loading transport events…</p> : null}
      {diagnostics.error ? <p role="alert">{diagnostics.error}</p> : null}
      <DebugEventList
        debugEntries={diagnostics.entries}
        hasSelectedSession={hasSelectedSession}
        hasSourceSession
      />
    </Modal>
  );
}
