import { accessApiContract } from "./apiContractAccess.ts";
import { agentApiContract } from "./apiContractAgents.ts";
import { cloudApiContract } from "./apiContractCloud.ts";
import { localLlmApiContract, localLlmPreviewApiContract } from "./apiContractLocalLlm.ts";
import { notificationApiContract } from "./apiContractNotifications.ts";
import { sessionApiContract, sessionLifecycleApiContract } from "./apiContractSessions.ts";
import {
  assetApiContract,
  runtimeApiContract,
  securityApiContract,
  systemBootstrapApiContract,
  systemManagementApiContract
} from "./apiContractSystem.ts";
import type { ApiContractRoute } from "./apiContractTypes.ts";

export type { ApiContractRoute } from "./apiContractTypes.ts";

export const daemonApiContract: ApiContractRoute[] = [
  ...systemBootstrapApiContract,
  ...accessApiContract,
  ...cloudApiContract,
  ...systemManagementApiContract,
  ...sessionApiContract,
  ...localLlmPreviewApiContract,
  ...sessionLifecycleApiContract,
  ...agentApiContract,
  ...runtimeApiContract,
  ...localLlmApiContract,
  ...securityApiContract,
  ...notificationApiContract,
  ...assetApiContract
];
