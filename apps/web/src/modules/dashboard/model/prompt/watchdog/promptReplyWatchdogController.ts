import type { AgentSessionDetail } from "@deskcue/protocol";
import { agentChatDetailResource } from "@modules/dashboard/model/chatDetail/resource/agentChatDetailResource";
import { PROMPT_REPLY_WATCHDOG_RETRY_MS } from "@modules/dashboard/model/prompt/constants";

import {
  canPoll,
  getNextPollDelay,
  observePromptReply
} from "./promptReplyWatchdogState";
import type { PromptWatch } from "./promptReplyWatchdogState";

interface PromptReplyWatchdogControllerOptions {
  applyAgentSession: (session: AgentSessionDetail) => void;
  completePrompt: () => void;
  isCurrentWatch: () => boolean;
  setPollingActive: (active: boolean) => void;
  watch: PromptWatch;
}

export class PromptReplyWatchdogController {
  private disposed = false;
  private pollTimer: number | null = null;

  constructor(private readonly options: PromptReplyWatchdogControllerOptions) {}

  start(initialDelay: number) {
    this.schedulePoll(initialDelay);
  }

  dispose() {
    this.disposed = true;
    this.clearPollTimer();
    this.options.setPollingActive(false);
  }

  private isCurrentWatch() {
    return !this.disposed && this.options.isCurrentWatch();
  }

  private clearPollTimer() {
    if (this.pollTimer === null) return;

    window.clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private stopPolling() {
    if (!this.isCurrentWatch()) return;

    this.options.watch.stopped = true;
    this.options.setPollingActive(false);
    this.clearPollTimer();
  }

  private schedulePoll(preferredDelay = PROMPT_REPLY_WATCHDOG_RETRY_MS) {
    if (!this.isCurrentWatch()) return;

    const now = Date.now();

    if (!canPoll(this.options.watch, now)) {
      this.stopPolling();
      return;
    }

    const delay = getNextPollDelay(this.options.watch, now, preferredDelay);

    this.pollTimer = window.setTimeout(() => {
      void this.poll();
    }, delay);
  }

  private completePrompt() {
    if (!this.isCurrentWatch()) return;
    if (Date.now() >= this.options.watch.hardDeadline) return;

    this.stopPolling();
    if (this.isCurrentWatch()) this.options.completePrompt();
  }

  private async poll() {
    this.clearPollTimer();
    if (!this.isCurrentWatch()) return;

    const now = Date.now();

    if (!canPoll(this.options.watch, now)) {
      this.stopPolling();
      return;
    }

    try {
      const session = await agentChatDetailResource.refreshNow(
        this.options.watch.agentSessionId,
        {
          activeTab: "overview",
          force: true,
          reason: "prompt-watchdog",
          retry: true,
          transcriptDetail: "summary"
        }
      );

      if (!this.isCurrentWatch()) return;

      if (Date.now() >= this.options.watch.hardDeadline) {
        this.stopPolling();
        return;
      }

      if (!session || session.id !== this.options.watch.agentSessionId) {
        this.schedulePoll();
        return;
      }

      this.options.applyAgentSession(session);
      if (!this.isCurrentWatch()) return;
      if (Date.now() >= this.options.watch.hardDeadline) return;

      if (observePromptReply(this.options.watch, session, Date.now())) {
        this.completePrompt();
        return;
      }

      this.schedulePoll();
    } catch {
      if (!this.isCurrentWatch()) return;

      if (Date.now() >= this.options.watch.hardDeadline) {
        this.stopPolling();
        return;
      }

      this.schedulePoll();
    }
  }
}
