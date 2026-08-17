import type { SessionDetail } from "@deskcue/protocol";
import { AppError } from "#application/errors";
import { isApprovalDecisionInput } from "#sessions/actionRequest/sessionActionRequest";
import { emptyReplyState } from "#sessions/model/sessionDefaults";

import type { PromptDeliveryJournal } from "./storeBackedPromptTransportCoordinator.ts";

type ManagedPromptDeliveryLifecycle = {
  markAccepted: () => void;
  markDispatching: () => boolean;
  markOutcomeUnknown: () => void;
};

type StoreBackedSessionInputCoordinatorOptions = {
  deliverInput: (
    sessionId: string,
    input: string,
    lifecycle?: ManagedPromptDeliveryLifecycle
  ) => Promise<SessionDetail>;
  getSession: (sessionId: string) => SessionDetail | null;
  hasManagedChild: (sessionId: string) => boolean;
  persistState: () => Promise<void>;
  promptDeliveries: PromptDeliveryJournal;
  updateSession: (sessionId: string, patch: Partial<SessionDetail>) => void;
};

type ManagedPromptDeliveryPhase =
  | "prepared"
  | "dispatching"
  | "accepted"
  | "outcome_unknown";

export class StoreBackedSessionInputCoordinator {
  private readonly inFlightSessionIds = new Set<string>();
  private readonly shutdownDrainWaiters: Array<() => void> = [];
  private shuttingDown = false;

  constructor(private readonly options: StoreBackedSessionInputCoordinatorOptions) {}

  async sendInput(sessionId: string, input: string): Promise<SessionDetail> {
    if (this.shuttingDown || this.inFlightSessionIds.has(sessionId)) {
      throw new AppError(
        "not_accepting_input",
        this.shuttingDown
          ? "DeskCue is shutting down and cannot accept input."
          : "Session is already handling input."
      );
    }

    this.inFlightSessionIds.add(sessionId);
    try {
      const session = this.options.getSession(sessionId);
      if (session && this.shouldJournalManagedPrompt(session, input)) {
        return await this.sendManagedPromptWithJournal(session, input);
      }
      return await this.options.deliverInput(sessionId, input);
    } finally {
      this.inFlightSessionIds.delete(sessionId);
      this.resolveShutdownDrain();
    }
  }

  beginShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.inFlightSessionIds.size === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.shutdownDrainWaiters.push(resolve);
    });
  }

  private shouldJournalManagedPrompt(session: SessionDetail, input: string) {
    return (
      this.options.hasManagedChild(session.id) &&
      !session.sourceSessionId &&
      !(session.actionRequest?.kind === "approval" && isApprovalDecisionInput(input))
    );
  }

  private async sendManagedPromptWithJournal(
    session: SessionDetail,
    input: string
  ): Promise<SessionDetail> {
    const requestedAt = new Date().toISOString();
    const deliveryId = this.options.promptDeliveries.prepare(session, input, requestedAt);
    let deliveryPhase: ManagedPromptDeliveryPhase = "prepared";
    this.options.updateSession(session.id, {
      promptRecovery: null,
      replyState: {
        phase: "sending",
        promptText: input,
        requestedAt
      }
    });

    try {
      await this.options.persistState();
      return await this.options.deliverInput(session.id, input, {
        markAccepted: () => {
          if (this.options.promptDeliveries.markAccepted(deliveryId)) {
            deliveryPhase = "accepted";
            this.options.updateSession(session.id, {
              promptRecovery: null,
              replyState: {
                phase: "waiting",
                promptText: input,
                requestedAt
              }
            });
            return;
          }
          this.options.promptDeliveries.markOutcomeUnknown(deliveryId);
          deliveryPhase = "outcome_unknown";
          this.options.updateSession(session.id, {
            promptRecovery: {
              phase: "outcome_unknown",
              promptText: input,
              requestedAt,
              retryable: false
            },
            replyState: emptyReplyState()
          });
        },
        markDispatching: () => {
          const dispatching = this.options.promptDeliveries.markDispatching(deliveryId);
          if (dispatching) {
            deliveryPhase = "dispatching";
            return true;
          }
          this.options.promptDeliveries.markNotSent(deliveryId);
          this.options.updateSession(session.id, {
            promptRecovery: {
              phase: "not_sent",
              promptText: input,
              requestedAt,
              retryable: true
            },
            replyState: emptyReplyState()
          });
          return false;
        },
        markOutcomeUnknown: () => {
          this.options.promptDeliveries.markOutcomeUnknown(deliveryId);
          deliveryPhase = "outcome_unknown";
          this.options.updateSession(session.id, {
            promptRecovery: {
              phase: "outcome_unknown",
              promptText: input,
              requestedAt,
              retryable: false
            },
            replyState: emptyReplyState()
          });
        }
      });
    } catch (error) {
      if (deliveryPhase === "prepared") {
        this.options.promptDeliveries.markNotSent(deliveryId);
        this.options.updateSession(session.id, {
          promptRecovery: {
            phase: "not_sent",
            promptText: input,
            requestedAt,
            retryable: true
          },
          replyState: emptyReplyState()
        });
      } else if (deliveryPhase === "dispatching" || deliveryPhase === "accepted") {
        this.options.promptDeliveries.markOutcomeUnknown(deliveryId);
        this.options.updateSession(session.id, {
          promptRecovery: {
            phase: "outcome_unknown",
            promptText: input,
            requestedAt,
            retryable: false
          },
          replyState: emptyReplyState()
        });
      }
      try {
        await this.options.persistState();
      } catch {
        // The prompt journal remains the durable recovery source of truth.
      }
      throw error;
    }
  }

  private resolveShutdownDrain() {
    if (this.inFlightSessionIds.size > 0) {
      return;
    }

    for (const resolve of this.shutdownDrainWaiters.splice(0)) {
      resolve();
    }
  }
}
