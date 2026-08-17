import type { SourceTurnInterruptLifecycle } from "#agents/sourceTurnInterruptLifecycle";
import type { DaemonEventBus } from "#application/ports";
import type { SessionGitPolling } from "#sessions/git/sessionGitPolling";
import type { SessionRunner } from "#sessions/process/sessionRunner";
import type { SessionRepository } from "#sessions/state/sessionRepository";

import type { PromptDeliveryJournal } from "./storeBackedPromptTransportCoordinator.ts";
import type { StoreBackedPersistenceController } from "../persistence/storeBackedPersistenceController.ts";

export type StoreBackedSessionOperationsOptions = {
  eventBus: DaemonEventBus;
  gitPolling: SessionGitPolling;
  persistence: StoreBackedPersistenceController;
  promptDeliveries?: PromptDeliveryJournal;
  repository: SessionRepository;
  sessionRunner: SessionRunner;
  sourceTurnInterrupts: SourceTurnInterruptLifecycle;
  openCodexDesktopThread?: (sourceSessionId: string) => Promise<void>;
};
