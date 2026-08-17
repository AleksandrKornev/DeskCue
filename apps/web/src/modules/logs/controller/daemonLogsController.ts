import { daemonApi } from "@api/endpoint/daemon/endpoints";

export const daemonLogsController = {
  getLogs: (limit: number) => daemonApi.getLogs(limit)
};

export type DaemonLogsController = typeof daemonLogsController;
