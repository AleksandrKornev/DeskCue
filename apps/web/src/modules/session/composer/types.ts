import type { SessionActionRequest } from "@deskcue/protocol";
import type { LiveUpdatesConnectionState } from "@models/liveUpdatesConnection";
import type { SendInputOptions } from "@models/promptDelivery";

export interface SessionMessageComposerProps {
  draftScopeKey: string;
  mode: "chat" | "inline";
  compactViewport?: boolean;
  canSendInput: boolean;
  viewerCount?: number;
  activePromptText?: string | null;
  actionRequest?: SessionActionRequest | null;
  inputUnavailableLabel?: string | null;
  sharedSessionHint?: string | null;
  liveUpdatesConnection?: LiveUpdatesConnectionState;
  isPromptInFlight: boolean;
  isPromptQueued?: boolean;
  isInterruptingPrompt: boolean;
  onInterruptPrompt: () => void;
  onSendInput: (instruction: string, options?: SendInputOptions) => Promise<boolean>;
}

export interface ActionDecisionPanelProps {
  actionRequest: SessionActionRequest;
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
}
